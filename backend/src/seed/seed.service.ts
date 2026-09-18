import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Certificate } from '../entities/certificate.entity';
import { Node } from '../entities/node.entity';
import { SwitchLog } from '../entities/switch-log.entity';
import {
  parsePemChain,
  verifyChain,
} from '../certificates/cert-utils';
import { randomUUID } from 'crypto';

const SAMPLES = path.resolve(__dirname, '..', '..', '..', 'samples');

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(Certificate) private readonly certRepo: Repository<Certificate>,
    @InjectRepository(Node) private readonly nodeRepo: Repository<Node>,
    @InjectRepository(SwitchLog) private readonly switchRepo: Repository<SwitchLog>,
  ) {}

  private importChain(file: string, label: string): Certificate | null {
    const p = path.join(SAMPLES, file);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const check = verifyChain(parsePemChain(raw), new Date());
    if (!check.valid) {
      this.logger.warn(`seed 跳过 ${file}: ${check.errors.join('; ')}`);
      return null;
    }
    const leaf = check.leaf;
    return this.certRepo.create({
      id: randomUUID(),
      label,
      fingerprintSha256: leaf.fingerprintSha256,
      subjectCn: leaf.subjectCn,
      issuerCn: leaf.issuerCn,
      serial: leaf.serial,
      signatureAlgorithm: leaf.signatureAlgorithm,
      notBefore: leaf.notBefore,
      notAfter: leaf.notAfter,
      sanDomains: leaf.sanDomains,
      chainPem: raw.replace(/\r\n/g, '\n').trim() + '\n',
      chainLength: check.certs.length,
      chainValid: true,
      sourceFilename: file,
    });
  }

  async onApplicationBootstrap() {
    if ((await this.nodeRepo.count()) > 0) return;

    const specs: Array<[string, string, string]> = [
      // test batch
      ['node-test-a', 'test', 'cn-east-1'],
      ['node-test-b', 'test', 'cn-north-1'],
      // canary
      ['node-canary-a', 'canary', 'cn-east-1'],
      // prod tail
      ['node-prod-a', 'prod', 'cn-east-1'],
      ['node-prod-b', 'prod', 'cn-north-1'],
      ['node-prod-c', 'prod', 'cn-south-1'],
      ['node-prod-d', 'prod', 'cn-east-2'],
    ];

    const nodes = specs.map(([name, env, region]) =>
      this.nodeRepo.create({
        id: randomUUID(),
        name,
        env,
        region,
        domain: name.includes('b') && env === 'prod' ? 'www.example.com' : 'api.example.com',
        simMode: 'normal',
        settings: { baseDelayMs: 0 },
        activeCertId: null,
        activeSince: null,
      }),
    );

    const currentCert = this.importChain('current-chain.pem', '当前证书 current-2026');
    const expiringCert = this.importChain('expiring-chain.pem', '临期证书（18天后到期）');
    const wildcardCert = this.importChain('wildcard-chain.pem', '泛域名证书 *.example.com');
    const certs = [currentCert, expiringCert, wildcardCert].filter(Boolean) as Certificate[];

    if (currentCert) {
      // all nodes start on the current cert
      for (const n of nodes) {
        n.activeCertId = currentCert.id;
        n.activeSince = new Date(Date.now() - 30 * 86_400_000);
      }
    }

    await this.certRepo.save(certs);
    await this.nodeRepo.save(nodes);

    if (currentCert) {
      await this.switchRepo.save(
        nodes.map((n) =>
          this.switchRepo.create({
            id: randomUUID(),
            nodeId: n.id,
            fromCertId: null,
            toCertId: currentCert.id,
            toFingerprint: currentCert.fingerprintSha256,
            action: 'deploy',
            detail: '初始化基线版本',
          }),
        ),
      );
    }

    this.logger.log(
      `seed 完成：${certs.length} 张证书，${nodes.length} 个节点`,
    );
  }
}
