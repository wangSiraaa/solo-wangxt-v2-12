import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Node } from '../entities/node.entity';
import { Certificate } from '../entities/certificate.entity';
import { SwitchLog } from '../entities/switch-log.entity';
import { SimulatorService } from '../simulator/simulator.service';

const UPDATEABLE = new Set(['simMode', 'baseDelayMs', 'region']);

@Injectable()
export class NodesService {
  constructor(
    @InjectRepository(Node) private readonly nodeRepo: Repository<Node>,
    @InjectRepository(Certificate)
    private readonly certRepo: Repository<Certificate>,
    @InjectRepository(SwitchLog)
    private readonly switchRepo: Repository<SwitchLog>,
    private readonly simulator: SimulatorService,
  ) {}

  async matrix() {
    const [nodes, certs, lastSwitches] = await Promise.all([
      this.nodeRepo.find({ order: { env: 'ASC', name: 'ASC' } }),
      this.certRepo.find(),
      this.switchRepo
        .createQueryBuilder('s')
        .distinctOn(['s.node_id'])
        .orderBy('s.node_id', 'ASC')
        .addOrderBy('s.switched_at', 'DESC')
        .getMany(),
    ]);

    const certById = new Map(certs.map((c) => [c.id, c]));
    const lastByNode = new Map(lastSwitches.map((s) => [s.nodeId, s]));
    const nowT = new Date();

    return Promise.all(
      nodes.map(async (n) => {
        const active = n.activeCertId ? certById.get(n.activeCertId) ?? null : null;
        const actual = await this.simulator.actualOf(n.id);
        const lastSwitch = lastByNode.get(n.id) ?? null;
        return {
        id: n.id,
        name: n.name,
        env: n.env,
        region: n.region,
        domain: n.domain,
        simMode: n.simMode,
        baseDelayMs: (n.settings as any)?.baseDelayMs ?? 0,
        controlPlane: active
          ? {
              certId: active.id,
              label: active.label,
              fingerprint: active.fingerprintSha256,
              notAfter: active.notAfter,
              valid: nowT <= active.notAfter,
              since: n.activeSince,
            }
          : null,
        /** what the simulated node is really serving */
        nodeActual: actual
          ? { certId: actual.certId, fingerprint: actual.fingerprint }
          : null,
        /** divergence matters after timeout/late receipt scenarios */
        convergent:
          (actual?.fingerprint ?? null) ===
          (active?.fingerprintSha256 ?? null),
        lastSwitch: lastSwitch
          ? {
              action: lastSwitch.action,
              toFingerprint: lastSwitch.toFingerprint,
              at: lastSwitch.switchedAt,
            }
          : null,
        };
      }),
    );
  }

  async update(
    id: string,
    patch: { simMode?: string; baseDelayMs?: number; region?: string },
  ) {
    const node = await this.nodeRepo.findOneBy({ id });
    if (!node) throw new NotFoundException('节点不存在');
    for (const [k, v] of Object.entries(patch)) {
      if (!UPDATEABLE.has(k) || v === undefined) continue;
      if (k === 'simMode') node.simMode = v as string;
      else if (k === 'region') node.region = v as string;
      else {
        node.settings = { ...(node.settings ?? {}), baseDelayMs: Number(v) };
      }
    }
    await this.nodeRepo.save(node);
    return { ok: true };
  }

  async forceFail(id: string) {
    const node = await this.nodeRepo.findOneBy({ id });
    if (!node) throw new NotFoundException('节点不存在');
    this.simulator.forceFailOnce(id);
    return { ok: true, message: `节点 ${node.name} 下一次推送将失败` };
  }

  async switchLog() {
    const [logs, nodes, certs] = await Promise.all([
      this.switchRepo.find({ order: { switchedAt: 'DESC' }, take: 200 }),
      this.nodeRepo.find(),
      this.certRepo.find(),
    ]);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const certMap = new Map(certs.map((c) => [c.id, c]));
    return logs.map((l) => ({
      id: l.id,
      switchedAt: l.switchedAt,
      nodeId: l.nodeId,
      nodeName: nodeMap.get(l.nodeId)?.name ?? '(已删除节点)',
      action: l.action,
      fromCertId: l.fromCertId,
      fromLabel: l.fromCertId ? certMap.get(l.fromCertId)?.label ?? null : null,
      toCertId: l.toCertId,
      toLabel: l.toCertId ? certMap.get(l.toCertId)?.label ?? null : null,
      toFingerprint: l.toFingerprint,
      relatedDeploymentId: l.relatedDeploymentId,
      detail: l.detail,
    }));
  }
}
