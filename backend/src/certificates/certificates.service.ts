import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Certificate } from '../entities/certificate.entity';
import { Node } from '../entities/node.entity';
import {
  assertNoPrivateKey,
  CertValidationError,
  certCoversDomain,
  parsePemChain,
  verifyChain,
} from './cert-utils';
import { daysBetween, now, uuid } from '../common/util';

export interface UploadResult {
  certificate: Certificate;
  warnings: string[];
  coveredDomains: string[];
}

@Injectable()
export class CertificatesService {
  constructor(
    @InjectRepository(Certificate)
    private readonly certRepo: Repository<Certificate>,
    @InjectRepository(Node)
    private readonly nodeRepo: Repository<Node>,
  ) {}

  async upload(
    raw: string,
    label: string,
    sourceFilename: string | null,
  ): Promise<UploadResult> {
    // 1) private key guard — private material must never enter this system
    assertNoPrivateKey(raw);

    const pems = parsePemChain(raw);

    // 2) validity window + chain of trust
    const check = verifyChain(pems, now());
    if (!check.valid) {
      throw new CertValidationError('证书校验未通过', check.errors);
    }

    const leaf = check.leaf;

    // 3) domain coverage against managed domains
    const nodes = await this.nodeRepo.find();
    const managedDomains = [...new Set(nodes.map((n) => n.domain))];
    const coveredDomains = managedDomains.filter((d) =>
      certCoversDomain(leaf, d),
    );
    if (coveredDomains.length === 0) {
      throw new CertValidationError('域名覆盖校验失败', [
        `叶子证书 SAN: ${leaf.sanDomains.join(', ') || '(空)'}`,
        `未覆盖任何受管域名: ${managedDomains.join(', ')}`,
      ]);
    }

    const exists = await this.certRepo.findOne({
      where: { fingerprintSha256: leaf.fingerprintSha256 },
    });
    if (exists) {
      const err = new CertValidationError('证书已存在', [
        `指纹 ${leaf.fingerprintSha256} 已于 ${exists.uploadedAt.toISOString()} 上传`,
      ]);
      (err as any).conflict = true;
      throw err;
    }

    const trimmed = pems.map((p) => p.replace(/\r\n/g, '\n').trim()).join('\n') + '\n';
    const entity = this.certRepo.create({
      id: uuid(),
      label: label.trim() || leaf.subjectCn,
      fingerprintSha256: leaf.fingerprintSha256,
      subjectCn: leaf.subjectCn,
      issuerCn: leaf.issuerCn,
      serial: leaf.serial,
      signatureAlgorithm: leaf.signatureAlgorithm,
      notBefore: leaf.notBefore,
      notAfter: leaf.notAfter,
      sanDomains: leaf.sanDomains,
      chainPem: trimmed,
      chainLength: check.certs.length,
      chainValid: true,
      sourceFilename,
    });
    await this.certRepo.save(entity);
    return { certificate: entity, warnings: check.warnings, coveredDomains };
  }

  async list() {
    const [certs, nodes] = await Promise.all([
      this.certRepo.find({ order: { uploadedAt: 'DESC' } }),
      this.nodeRepo.find(),
    ]);
    const t = now();
    return certs.map((c) => {
      const activeNodes = nodes.filter((n) => n.activeCertId === c.id);
      return {
        ...c,
        status:
          t > c.notAfter
            ? 'expired'
            : daysBetween(t, c.notAfter) <= 30
              ? 'expiring'
              : 'valid',
        daysToExpiry: daysBetween(t, c.notAfter),
        coveredDomains: [...new Set(nodes.map((n) => n.domain))].filter((d) =>
          c.sanDomains.some(
            (san) =>
              san === d ||
              (san.startsWith('*.') &&
                d.slice(d.indexOf('.') + 1) === san.slice(2) &&
                d.indexOf('.') > 0),
          ),
        ),
        activeNodeCount: activeNodes.length,
        activeNodeNames: activeNodes.map((n) => n.name),
      };
    });
  }

  async expiring(withinDays = 30) {
    const all = await this.list();
    return all.filter(
      (c) => c.status === 'expired' || c.daysToExpiry <= withinDays,
    );
  }

  async get(id: string) {
    const c = await this.certRepo.findOneByOrFail({ id });
    const list = await this.list();
    return list.find((x) => x.id === id)! ?? c;
  }
}
