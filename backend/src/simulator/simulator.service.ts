import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Node } from '../entities/node.entity';
import { Certificate } from '../entities/certificate.entity';

export interface SimResponse {
  result: 'success' | 'error';
  fingerprint: string;
  detail: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (min: number, max: number) =>
  Math.round(min + Math.random() * (max - min));

/**
 * In-process stand-in for a real TLS node agent. Each node keeps its own
 * "actually serving" state independent of the control plane, so timeouts
 * and late receipts reveal real divergence.
 */
@Injectable()
export class SimulatorService implements OnModuleInit {
  /** nodeId -> what the node is really serving right now */
  private actual = new Map<string, { certId: string; fingerprint: string }>();

  /** fail the next push even in normal mode (manual injection) */
  private forcedFailure = new Set<string>();

  constructor(
    @InjectRepository(Node) private readonly nodeRepo: Repository<Node>,
    @InjectRepository(Certificate)
    private readonly certRepo: Repository<Certificate>,
  ) {}

  async onModuleInit() {
    await this.bootstrap();
  }

  /** Seed runs after onModuleInit, so (re)hydrate lazily as well:
   *  every call fills in nodes that appeared since the last hydration. */
  private async bootstrap() {
    const nodes = await this.nodeRepo.find();
    await Promise.all(
      nodes.map(async (n) => {
        if (n.activeCertId && !this.actual.has(n.id)) {
          const c = await this.certRepo.findOneBy({ id: n.activeCertId });
          if (c) this.actual.set(n.id, { certId: c.id, fingerprint: c.fingerprintSha256 });
        }
      }),
    );
  }

  async actualOf(nodeId: string) {
    await this.bootstrap();
    return this.actual.get(nodeId) ?? null;
  }

  async refreshNode(node: Node) {
    if (node.activeCertId) {
      const c = await this.certRepo.findOneBy({ id: node.activeCertId });
      if (c) this.actual.set(node.id, { certId: c.id, fingerprint: c.fingerprintSha256 });
    }
  }

  forceFailOnce(nodeId: string) {
    this.forcedFailure.add(nodeId);
  }

  /**
   * Push a cert to a node. `onEmit` fires for every receipt the node
   * produces (including the duplicate second receipt in duplicate mode).
   * Resolves with the first emission; rejects with 'timeout' when the
   * node misses the deadline (a late success may still arrive).
   */
  async push(opts: {
    nodeId: string;
    certId: string;
    requestId: string;
    deadlineMs?: number;
    onEmit?: (r: SimResponse & { late?: boolean }) => void;
  }): Promise<SimResponse> {
    const { nodeId, certId } = opts;
    const deadlineMs = opts.deadlineMs ?? 2500;
    const node = await this.nodeRepo.findOneByOrFail({ id: nodeId });
    const cert = await this.certRepo.findOneByOrFail({ id: certId });
    const base = (node.settings as any)?.baseDelayMs ?? 0;

    const emitSuccess = (late = false): SimResponse => {
      this.actual.set(nodeId, { certId, fingerprint: cert.fingerprintSha256 });
      const r: SimResponse = {
        result: 'success',
        fingerprint: cert.fingerprintSha256,
        detail: late ? '节点迟到回执：推送实际已生效' : '节点已加载新证书并重载 TLS',
      };
      opts.onEmit?.({ ...r, late });
      return r;
    };
    const emitError = (detail: string): SimResponse => {
      const cur = this.actual.get(nodeId);
      const r: SimResponse = {
        result: 'error',
        fingerprint: cur?.fingerprint ?? '',
        detail,
      };
      opts.onEmit?.(r);
      return r;
    };

    const forced = this.forcedFailure.delete(nodeId);
    const mode = forced ? 'fail' : node.simMode;

    const work = (async (): Promise<SimResponse> => {
      switch (mode) {
        case 'fail':
          await sleep(base + rand(150, 450));
          return emitError(`节点 ${node.name} 拒绝加载：模拟部署失败 (reload failed)`);
        case 'flaky':
          await sleep(base + rand(300, 900));
          if (Math.random() < 0.55) {
            return emitError(`节点 ${node.name} 抖动：本次随机失败`);
          }
          return emitSuccess();
        case 'timeout': {
          // node takes far longer than the control-plane deadline,
          // then applies the cert and sends a late receipt
          await sleep(base + rand(5000, 7000));
          return emitSuccess(true);
        }
        case 'duplicate': {
          await sleep(base + rand(200, 500));
          const first = emitSuccess();
          // agent retries its ack -> identical receipt a moment later
          sleep(rand(300, 800)).then(() => {
            opts.onEmit?.({ ...first });
          });
          return first;
        }
        case 'normal':
        default:
          await sleep(base + rand(150, 600));
          return emitSuccess();
      }
    })();

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<SimResponse>((_, reject) => {
      timer = setTimeout(
        () => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })),
        deadlineMs,
      );
    });
    try {
      const r = await Promise.race([work, timeout]);
      // an error receipt is a failed push even though the call returned:
      // the node told us it rejected the cert and kept its old version
      if (r.result === 'error') {
        throw Object.assign(new Error(r.detail), { code: 'NODE_REJECTED' });
      }
      return r;
    } finally {
      clearTimeout(timer!);
    }
  }
}
