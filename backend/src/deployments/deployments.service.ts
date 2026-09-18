import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Deployment } from '../entities/deployment.entity';
import { DeploymentTask } from '../entities/deployment-task.entity';
import { Node } from '../entities/node.entity';
import { Certificate } from '../entities/certificate.entity';
import { NodeReceipt } from '../entities/node-receipt.entity';
import { SwitchLog } from '../entities/switch-log.entity';
import { SimulatorService } from '../simulator/simulator.service';
import { certCoversDomain } from '../certificates/cert-utils';
import { now } from '../common/util';

const ENV_ORDER = ['test', 'canary', 'prod'];
/** control-plane deadline for a single node push */
const DEADLINE_MS = 2500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class DeploymentsService {
  private readonly logger = new Logger(DeploymentsService.name);
  /** deployments currently executing a batch (single-flight guard) */
  private running = new Set<string>();
  /** hold at the gate even though the batch succeeded */
  private pauseRequested = new Set<string>();

  constructor(
    @InjectRepository(Deployment)
    private readonly deployRepo: Repository<Deployment>,
    @InjectRepository(DeploymentTask)
    private readonly taskRepo: Repository<DeploymentTask>,
    @InjectRepository(Node) private readonly nodeRepo: Repository<Node>,
    @InjectRepository(Certificate)
    private readonly certRepo: Repository<Certificate>,
    @InjectRepository(NodeReceipt)
    private readonly receiptRepo: Repository<NodeReceipt>,
    @InjectRepository(SwitchLog)
    private readonly switchRepo: Repository<SwitchLog>,
    private readonly simulator: SimulatorService,
    private readonly ds: DataSource,
  ) {}

  // ---------------------------------------------------------------- plan

  /** Nodes grouped into batches: test -> canary -> prod, cert-covered only */
  planBatches(cert: Certificate, nodes: Node[]) {
    const eligible = nodes.filter((n) =>
      cert.sanDomains.some((d) => domainMatches(d, n.domain)),
    );
    const batches: Node[][] = ENV_ORDER.map((env) =>
      eligible.filter((n) => n.env === env),
    ).filter((b) => b.length > 0);
    return { eligible, batches };
  }

  async create(certId: string, note?: string) {
    const cert = await this.certRepo.findOneBy({ id: certId });
    if (!cert) throw new NotFoundException('证书不存在');
    const t = now();
    if (t > cert.notAfter) {
      throw new BadRequestException({
        message: '不能部署已过期证书',
        details: [`notAfter=${cert.notAfter.toISOString()}`],
      });
    }

    const nodes = await this.nodeRepo.find();
    const { eligible, batches } = this.planBatches(cert, nodes);
    if (eligible.length === 0) {
      throw new BadRequestException({
        message: '没有可部署节点',
        details: [`证书 SAN ${cert.sanDomains.join(', ')} 不覆盖任何节点域名`],
      });
    }

    // no two active rollouts for the same cert
    const busy = await this.deployRepo.findOne({
      where: { certId, status: In(['running', 'paused', 'draft']) },
    });
    if (busy) {
      throw new ConflictException({
        message: '该证书已有进行中的部署',
        deploymentId: busy.id,
      });
    }

    const deployment = await this.ds.transaction(async (m) => {
      const depId = randomUUID();
      const dep = m.getRepository(Deployment).create({
        id: depId,
        certId,
        batchIndex: 0,
        currentEnv: batches[0][0].env,
        status: 'paused',
        note: note ?? null,
        updatedAt: now(),
      });
      await m.getRepository(Deployment).save(dep);

      const tasks = batches.flatMap((batch, bi) =>
        batch.map((node) =>
          m.getRepository(DeploymentTask).create({
            id: randomUUID(),
            deploymentId: depId,
            nodeId: node.id,
            batchIndex: bi,
            env: node.env,
            status: 'pending',
          }),
        ),
      );
      await m.getRepository(DeploymentTask).save(tasks);
      return dep;
    });

    return this.detail(deployment.id);
  }

  // ---------------------------------------------------------------- run

  private async executeBatch(deploymentId: string) {
    if (this.running.has(deploymentId)) return;
    this.running.add(deploymentId);
    try {
      const dep = await this.deployRepo.findOneByOrFail({ id: deploymentId });
      if (dep.status !== 'running') return;

      const cert = await this.certRepo.findOneByOrFail({ id: dep.certId });
      const tasks = await this.taskRepo.find({
        where: { deploymentId, batchIndex: dep.batchIndex },
        order: { env: 'ASC', id: 'ASC' },
      });

      // Sequential within a batch so partial success is deterministic:
      // an early failure does not mask what happened to later nodes.
      for (const task of tasks) {
        const fresh = await this.taskRepo.findOneByOrFail({ id: task.id });
        if (fresh.status === 'succeeded') continue;

        const requestId = randomUUID();
        fresh.status = 'in_flight';
        fresh.attemptCount += 1;
        fresh.lastRequestId = requestId;
        fresh.startedAt = now();
        fresh.error = null;
        await this.taskRepo.save(fresh);

        try {
          await this.simulator.push({
            nodeId: fresh.nodeId,
            certId: dep.certId,
            requestId,
            deadlineMs: DEADLINE_MS,
            onEmit: (r) =>
              this.acceptReceipt({
                requestId,
                task: fresh,
                deploymentId,
                certId: dep.certId,
                response: r,
              }),
          });

          await this.markSuccess(fresh, dep, cert);
        } catch (e) {
          const code = (e as any).code;
          fresh.status = code === 'TIMEOUT' ? 'timeout' : 'failed';
          fresh.error =
            code === 'TIMEOUT'
              ? `控制面 ${DEADLINE_MS}ms 内未收到回执（节点可能稍后迟到回执）`
              : (e as Error).message;
          fresh.finishedAt = now();
          await this.taskRepo.save(fresh);
          this.logger.warn(
            `task ${fresh.id} -> ${fresh.status}: ${fresh.error}`,
          );
        }
      }

      // Reconcile late receipts that arrived meanwhile, then settle batch
      await this.reconcileLate(dep);

      if (this.pauseRequested.delete(deploymentId)) {
        // explicit pause: stop the whole rollout at this batch
        dep.status = 'paused';
        dep.note = '人工暂停';
        dep.updatedAt = now();
        await this.deployRepo.save(dep);
        return;
      }
      await this.settleBatch(dep);
    } finally {
      this.running.delete(deploymentId);
    }
  }

  private async markSuccess(
    task: DeploymentTask,
    dep: Deployment,
    cert: Certificate,
  ) {
    if (task.status === 'succeeded') return;
    await this.ds.transaction(async (m) => {
      const node = await m.getRepository(Node).findOneByOrFail({ id: task.nodeId });
      const fromId = node.activeCertId;
      task.status = 'succeeded';
      task.error = null;
      task.finishedAt = now();
      await m.getRepository(DeploymentTask).save(task);

      if (node.activeCertId !== cert.id) {
        node.activeCertId = cert.id;
        node.activeSince = now();
        await m.getRepository(Node).save(node);
        await m.getRepository(SwitchLog).save(
          m.getRepository(SwitchLog).create({
            id: randomUUID(),
            nodeId: node.id,
            fromCertId: fromId,
            toCertId: cert.id,
            toFingerprint: cert.fingerprintSha256,
            action: 'deploy',
            relatedDeploymentId: dep.id,
            detail: `批次 ${dep.batchIndex} (${dep.currentEnv})`,
          }),
        );
      }
    });
  }

  /** A late success may turn a timed-out task into a real switch. */
  private async reconcileLate(dep: Deployment) {
    const open = await this.taskRepo.find({
      where: { deploymentId: dep.id, status: In(['timeout', 'failed']) },
    });
    const cert = await this.certRepo.findOneByOrFail({ id: dep.certId });
    for (const task of open) {
      const actual = await this.simulator.actualOf(task.nodeId);
      if (actual && actual.certId === dep.certId) {
        await this.ds.transaction(async (m) => {
          const node = await m
            .getRepository(Node)
            .findOneByOrFail({ id: task.nodeId });
          const fromId = node.activeCertId;
          task.status = 'succeeded';
          task.error = '迟到回执：节点最终加载成功，已按实际版本记录';
          task.finishedAt = now();
          await m.getRepository(DeploymentTask).save(task);
          if (node.activeCertId !== cert.id) {
            node.activeCertId = cert.id;
            node.activeSince = now();
            await m.getRepository(Node).save(node);
            await m.getRepository(SwitchLog).save(
              m.getRepository(SwitchLog).create({
                id: randomUUID(),
                nodeId: node.id,
                fromCertId: fromId,
                toCertId: cert.id,
                toFingerprint: cert.fingerprintSha256,
                action: 'deploy',
                relatedDeploymentId: dep.id,
                detail: '迟到回执对账',
              }),
            );
          }
        });
      }
    }
  }

  private async settleBatch(dep: Deployment) {
    const tasks = await this.taskRepo.find({
      where: { deploymentId: dep.id, batchIndex: dep.batchIndex },
    });
    const allOk = tasks.every((t) => t.status === 'succeeded');

    const allTasks = await this.taskRepo.find({
      where: { deploymentId: dep.id },
    });
    const totalBatches = Math.max(...allTasks.map((t) => t.batchIndex)) + 1;
    const lastBatch = dep.batchIndex >= totalBatches - 1;

    if (allOk && lastBatch) {
      dep.status = 'completed';
    } else if (allOk) {
      // gate: test/canary verified — wait for manual promotion
      dep.status = 'paused';
      dep.note = `批次 ${dep.batchIndex} (${dep.currentEnv}) 验证通过，等待人工推进`;
    } else {
      // keep the real versions of every other node; block on this batch
      dep.status = 'failed';
      const bad = tasks.filter((t) => t.status !== 'succeeded');
      dep.note = `批次 ${dep.batchIndex} (${dep.currentEnv}) 有 ${bad.length} 个节点失败，已暂停；其他节点保留实际版本`;
    }
    dep.updatedAt = now();
    await this.deployRepo.save(dep);
  }

  async start(id: string) {
    const dep = await this.deployRepo.findOneByOrFail({ id });
    if (dep.status === 'completed' || dep.status === 'rolled_back') {
      throw new ConflictException('该部署已结束');
    }
    if (dep.status === 'running') {
      throw new ConflictException('批次执行中');
    }
    this.pauseRequested.delete(id);
    dep.status = 'running';
    dep.updatedAt = now();
    await this.deployRepo.save(dep);
    await this.executeBatch(id);
    return this.detail(id);
  }

  /** Retry failed/timeout tasks in the current batch (their real version stays put) */
  async retryBatch(id: string) {
    const dep = await this.deployRepo.findOneByOrFail({ id });
    if (dep.status === 'running') throw new ConflictException('批次执行中');
    this.pauseRequested.delete(id);

    // a timed-out task may have a late success already applied on the node;
    // reconcile that before re-pushing anything
    await this.reconcileLate(dep);

    const tasks = await this.taskRepo.find({
      where: { deploymentId: id, batchIndex: dep.batchIndex },
    });
    for (const t of tasks) {
      if (t.status !== 'succeeded') {
        t.status = 'pending';
        t.error = null;
        t.startedAt = null;
        t.finishedAt = null;
        await this.taskRepo.save(t);
      }
    }
    dep.status = 'running';
    dep.updatedAt = now();
    await this.deployRepo.save(dep);
    await this.executeBatch(id);
    return this.detail(id);
  }

  /** Pause: only meaningful while a batch is running; stop post-batch promotion */
  async pause(id: string) {
    const dep = await this.deployRepo.findOneByOrFail({ id });
    if (dep.status !== 'running' && dep.status !== 'paused') {
      throw new ConflictException(`当前状态 ${dep.status} 不可暂停`);
    }
    // do not flip status mid-batch (executeBatch owns it); mark intent so
    // the rollout holds at the gate as soon as the batch settles
    this.pauseRequested.add(id);
    return this.detail(id);
  }

  /** Promote to next env batch — only when the current gate fully passed */
  async promote(id: string) {
    const dep = await this.deployRepo.findOneByOrFail({ id });
    if (dep.status !== 'paused') {
      throw new ConflictException('只有停在灰度门的部署可以推进');
    }
    const tasks = await this.taskRepo.find({
      where: { deploymentId: id, batchIndex: dep.batchIndex },
    });
    if (!tasks.every((t) => t.status === 'succeeded')) {
      throw new ConflictException('当前批次存在未成功节点，请重试或处理后再推进');
    }
    const all = await this.taskRepo.find({ where: { deploymentId: id } });
    const totalBatches = Math.max(...all.map((t) => t.batchIndex)) + 1;
    if (dep.batchIndex + 1 >= totalBatches) {
      throw new ConflictException('已是最后一批');
    }
    dep.batchIndex += 1;
    dep.currentEnv = all.find((t) => t.batchIndex === dep.batchIndex)!.env;
    this.pauseRequested.delete(id);
    dep.status = 'running';
    dep.note = `推进至批次 ${dep.batchIndex} (${dep.currentEnv})`;
    dep.updatedAt = now();
    await this.deployRepo.save(dep);
    await this.executeBatch(id);
    return this.detail(id);
  }

  // ---------------------------------------------------------------- receipts

  private async acceptReceipt(opts: {
    requestId: string;
    task: DeploymentTask;
    deploymentId: string;
    certId: string;
    response: { result: string; fingerprint: string; detail: string; late?: boolean };
  }) {
    const { requestId, task, deploymentId, certId, response } = opts;
    const prior = await this.receiptRepo.find({ where: { requestId } });
    const isDup = prior.length > 0;
    await this.receiptRepo.save(
      this.receiptRepo.create({
        id: randomUUID(),
        requestId,
        nodeId: task.nodeId,
        deploymentId,
        certId,
        reportedFingerprint: response.fingerprint,
        result: isDup ? 'duplicate' : response.result,
        detail: isDup
          ? `重复回执（首次结果 ${prior[0].result} 已处理，本次忽略）`
          : response.detail,
      }),
    );
  }

  // ---------------------------------------------------------------- rollback

  /**
   * Rollback candidates per node: still valid, domain-matching,
   * and not the cert currently being rolled away from.
   */
  async rollbackCandidates(deploymentId: string) {
    const dep = await this.deployRepo.findOneByOrFail({ id: deploymentId });
    const [tasks, certs, nodes] = await Promise.all([
      this.taskRepo.find({ where: { deploymentId } }),
      this.certRepo.find(),
      this.nodeRepo.find(),
    ]);
    const t = now();
    return tasks.map((task) => {
      const node = nodes.find((n) => n.id === task.nodeId)!;
      const candidates = certs
        .filter((c) => c.id !== dep.certId && t <= c.notAfter)
        .filter((c) => c.sanDomains.some((d) => domainMatches(d, node.domain)))
        .map((c) => ({
          certId: c.id,
          label: c.label,
          fingerprint: c.fingerprintSha256,
          notAfter: c.notAfter,
          isActive: node.activeCertId === c.id,
        }));
      return {
        nodeId: node.id,
        nodeName: node.name,
        env: node.env,
        domain: node.domain,
        currentCertId: node.activeCertId,
        candidates,
      };
    });
  }

  /**
   * Roll a set of nodes back. Each node validates independently;
   * failure on one node never changes the others' real versions.
   */
  async rollback(id: string, targetCertId?: string, nodeIds?: string[]) {
    const dep = await this.deployRepo.findOneByOrFail({ id });
    const tasks = await this.taskRepo.find({ where: { deploymentId: id } });
    let targets = tasks;
    if (nodeIds && nodeIds.length > 0) {
      targets = tasks.filter((t) => nodeIds.includes(t.nodeId));
    }
    if (targets.length === 0) {
      throw new BadRequestException('没有可回滚的节点');
    }

    const t = now();
    const results: Array<Record<string, unknown>> = [];
    const blockers: string[] = [];

    for (const task of targets) {
      const node = await this.nodeRepo.findOneByOrFail({ id: task.nodeId });
      // resolve target: explicit > node's pre-deployment active cert
      let targetId = targetCertId ?? node.activeCertId;
      const fromCertId = node.activeCertId;

      // If the node already runs the rolled-out cert, find the previous
      // deploy switch to recover the prior cert id.
      const previousSwitch = await this.switchRepo.findOne({
        where: { nodeId: node.id, relatedDeploymentId: id, action: 'deploy' },
        order: { switchedAt: 'ASC' },
      });

      if ((!targetId || targetId === dep.certId) && previousSwitch?.fromCertId) {
        targetId = previousSwitch.fromCertId;
      }

      const target = targetId
        ? await this.certRepo.findOneBy({ id: targetId })
        : null;

      if (!target) {
        blockers.push(`${node.name}: 找不到回滚目标证书`);
        results.push({ nodeId: node.id, nodeName: node.name, ok: false, reason: 'no-target' });
        continue;
      }
      if (t > target.notAfter) {
        blockers.push(`${node.name}: 目标证书 ${target.label} 已过期`);
        results.push({ nodeId: node.id, nodeName: node.name, ok: false, reason: 'expired' });
        continue;
      }
      if (!target.sanDomains.some((d) => domainMatches(d, node.domain))) {
        blockers.push(
          `${node.name}: 目标证书 ${target.label} 不覆盖域名 ${node.domain} (SAN ${target.sanDomains.join(',')})`,
        );
        results.push({ nodeId: node.id, nodeName: node.name, ok: false, reason: 'domain-mismatch' });
        continue;
      }
      if (node.activeCertId === target.id) {
        results.push({ nodeId: node.id, nodeName: node.name, ok: true, skipped: true, reason: 'already-on-target' });
        continue;
      }

      // push via simulator so the same failure modes apply to rollback
      const requestId = randomUUID();
      let pushOk = false;
      let timedOut = false;
      let errMsg = '';
      try {
        await this.simulator.push({
          nodeId: node.id,
          certId: target.id,
          requestId,
          deadlineMs: DEADLINE_MS,
          onEmit: (r) =>
            this.acceptReceipt({
              requestId,
              task,
              deploymentId: id,
              certId: target.id,
              response: r,
            }),
        });
        pushOk = true;
      } catch (e) {
        errMsg = (e as Error).message;
        timedOut = (e as any).code === 'TIMEOUT';
      }

      if (!pushOk) {
        if (timedOut) {
          // wait for the late receipt a node normally sends right after a deadline
          await sleep(6500);
        }
        const actual = await this.simulator.actualOf(node.id);
        if (actual?.certId === target.id) {
          pushOk = true;
          errMsg = '';
        }
      }

      if (!pushOk) {
        blockers.push(`${node.name}: 回滚推送失败 (${errMsg})，节点保留实际版本`);
        results.push({ nodeId: node.id, nodeName: node.name, ok: false, reason: 'push-failed', detail: errMsg });
        continue;
      }

      await this.ds.transaction(async (m) => {
        node.activeCertId = target.id;
        node.activeSince = now();
        await m.getRepository(Node).save(node);
        await m.getRepository(SwitchLog).save(
          m.getRepository(SwitchLog).create({
            id: randomUUID(),
            nodeId: node.id,
            fromCertId,
            toCertId: target.id,
            toFingerprint: target.fingerprintSha256,
            action: 'rollback',
            relatedDeploymentId: id,
            detail: `回滚至 ${target.label}`,
          }),
        );
      });
      results.push({ nodeId: node.id, nodeName: node.name, ok: true, certId: target.id, fingerprint: target.fingerprintSha256 });
    }

    // mark deployment rolled_back when at least one node moved off the cert
    const moved = results.some((r) => r.ok && !r.skipped);
    if (moved) {
      dep.status = 'rolled_back';
      dep.note = '执行回滚（部分节点可能保留新版本，见结果明细）';
      dep.updatedAt = now();
      await this.deployRepo.save(dep);
    }

    return { ok: blockers.length === 0, moved, results, blockers };
  }

  // ---------------------------------------------------------------- views

  async list() {
    const deps = await this.deployRepo.find({ order: { createdAt: 'DESC' } });
    const [certs, tasks] = await Promise.all([
      this.certRepo.find(),
      this.taskRepo.find(),
    ]);
    const certMap = new Map(certs.map((c) => [c.id, c]));
    return deps.map((d) => {
      const dt = tasks.filter((t) => t.deploymentId === d.id);
      const groups = ENV_ORDER.map((env) => {
        const list = dt.filter((t) => t.env === env);
        if (list.length === 0) return null;
        return {
          env,
          total: list.length,
          succeeded: list.filter((t) => t.status === 'succeeded').length,
          failed: list.filter((t) => ['failed', 'timeout'].includes(t.status)).length,
          pending: list.filter((t) => ['pending', 'in_flight'].includes(t.status)).length,
        };
      }).filter(Boolean);
      return {
        id: d.id,
        certId: d.certId,
        certLabel: certMap.get(d.certId)?.label ?? '?',
        certFingerprint: certMap.get(d.certId)?.fingerprintSha256 ?? '?',
        status: d.status,
        batchIndex: d.batchIndex,
        currentEnv: d.currentEnv,
        note: d.note,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        batches: groups,
      };
    });
  }

  async detail(id: string) {
    const dep = await this.deployRepo.findOneByOrFail({ id });
    const cert = await this.certRepo.findOneByOrFail({ id: dep.certId });
    const tasks = await this.taskRepo.find({
      where: { deploymentId: id },
      order: { batchIndex: 'ASC', id: 'ASC' },
    });
    const nodes = await this.nodeRepo.find();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const totalBatches = Math.max(0, ...tasks.map((t) => t.batchIndex)) + (tasks.length ? 1 : 0);

    const receipts = await this.receiptRepo.find({
      where: { deploymentId: id },
      order: { receivedAt: 'ASC' },
    });

    return {
      id: dep.id,
      status: dep.status,
      batchIndex: dep.batchIndex,
      currentEnv: dep.currentEnv,
      note: dep.note,
      createdAt: dep.createdAt,
      updatedAt: dep.updatedAt,
      totalBatches,
      cert: {
        id: cert.id,
        label: cert.label,
        fingerprint: cert.fingerprintSha256,
        notAfter: cert.notAfter,
        sanDomains: cert.sanDomains,
      },
      tasks: await Promise.all(
        tasks.map(async (t) => {
          const n = nodeMap.get(t.nodeId);
          const actual = await this.simulator.actualOf(t.nodeId);
          return {
            id: t.id,
            nodeId: t.nodeId,
            nodeName: n?.name,
            region: n?.region,
            env: t.env,
            batchIndex: t.batchIndex,
            domain: n?.domain,
            status: t.status,
            attemptCount: t.attemptCount,
            error: t.error,
            startedAt: t.startedAt,
            finishedAt: t.finishedAt,
            nodeActualFingerprint: actual?.fingerprint ?? null,
          };
        }),
      ),
      receipts: receipts.map((r) => ({
        id: r.id,
        nodeId: r.nodeId,
        nodeName: nodeMap.get(r.nodeId)?.name,
        result: r.result,
        requestId: r.requestId,
        reportedFingerprint: r.reportedFingerprint,
        detail: r.detail,
        receivedAt: r.receivedAt,
      })),
    };
  }
}

function domainMatches(certSan: string, target: string): boolean {
  const c = certSan.toLowerCase().replace(/\.$/, '');
  const t = target.toLowerCase().replace(/\.$/, '');
  if (c === t) return true;
  if (c.startsWith('*.')) {
    const dot = t.indexOf('.');
    return dot > 0 && t.slice(dot + 1) === c.slice(2);
  }
  return false;
}
