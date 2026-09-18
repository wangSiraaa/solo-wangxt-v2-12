import * as forge from 'node-forge';

export interface ParsedCert {
  pem: string;
  cert: forge.pki.Certificate;
  subjectCn: string;
  issuerCn: string;
  serial: string;
  fingerprintSha256: string;
  signatureAlgorithm: string;
  notBefore: Date;
  notAfter: Date;
  sanDomains: string[];
  isCa: boolean;
}

export interface ChainCheckResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  certs: ParsedCert[];
  leaf: ParsedCert;
}

export class CertValidationError extends Error {
  constructor(
    message: string,
    public readonly details: string[] = [],
  ) {
    super(message);
  }
}

const PEM_RE =
  /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
const PRIVATE_KEY_RE =
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----/;

function attr(cert: forge.pki.Certificate, name: string): string {
  const attrs = cert.subject.attributes as { name?: string; value?: string }[];
  return attrs.find((a) => a.name === name)?.value ?? '';
}

function issuerAttr(cert: forge.pki.Certificate, name: string): string {
  const attrs = cert.issuer.attributes as { name?: string; value?: string }[];
  return attrs.find((a) => a.name === name)?.value ?? '';
}

export function parsePemChain(input: string): string[] {
  const matches = input.match(PEM_RE);
  if (!matches || matches.length === 0) {
    throw new CertValidationError('未找到 PEM 证书', [
      '请粘贴或上传至少一个 -----BEGIN CERTIFICATE----- 块',
    ]);
  }
  return matches;
}

export function assertNoPrivateKey(input: string): void {
  if (PRIVATE_KEY_RE.test(input)) {
    throw new CertValidationError('检测到私钥内容，本系统禁止导入私钥', [
      '工作台只保存证书链（公钥证书），私钥请保留在 KMS / 节点本地',
    ]);
  }
}

export function parseCert(pem: string): ParsedCert {
  let cert: forge.pki.Certificate;
  try {
    cert = forge.pki.certificateFromPem(pem);
  } catch (e) {
    throw new CertValidationError('证书解析失败', [
      (e as Error).message,
    ]);
  }

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const md = forge.md.sha256.create();
  md.update(der);
  const fingerprintSha256 = md
    .digest()
    .toHex()
    .match(/.{1,2}/g)!
    .join(':')
    .toUpperCase();

  const ext = cert.getExtension({ name: 'subjectAltName' }) as
    | { altNames?: { type: number; value: string }[] }
    | undefined;
  let sanDomains =
    ext?.altNames
      ?.filter((a) => a.type === 2)
      .map((a) => a.value) ?? [];

  const cn = attr(cert, 'commonName');
  if (sanDomains.length === 0 && cn) sanDomains = [cn];
  sanDomains = [...new Set(sanDomains.map((d) => d.toLowerCase()))];

  const bc = cert.getExtension({ name: 'basicConstraints' }) as
    | { cA?: boolean }
    | undefined;

  return {
    pem,
    cert,
    subjectCn: cn,
    issuerCn: issuerAttr(cert, 'commonName'),
    serial: cert.serialNumber,
    fingerprintSha256,
    signatureAlgorithm: String((cert as any).signatureOid?.id ?? 'unknown'),
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    sanDomains,
    isCa: bc?.cA === true,
  };
}

export function domainCovers(certDomain: string, target: string): boolean {
  const c = certDomain.toLowerCase().replace(/\.$/, '');
  const t = target.toLowerCase().replace(/\.$/, '');
  if (c === t) return true;
  if (c.startsWith('*.')) {
    const base = c.slice(2);
    const dot = t.indexOf('.');
    return dot > 0 && t.slice(dot + 1) === base;
  }
  return false;
}

export function certCoversDomain(parsed: ParsedCert, domain: string): boolean {
  return parsed.sanDomains.some((d) => domainCovers(d, domain));
}

/**
 * Verify the uploaded chain: every link signed by the next, validity windows,
 * basicConstraints CA path, and a final self-signed root (or at least a
 * chain whose last link is a CA that validates the previous one).
 */
export function verifyChain(pems: string[], nowDate = new Date()): ChainCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let certs: ParsedCert[];
  try {
    certs = pems.map(parseCert);
  } catch (e) {
    throw e as CertValidationError;
  }

  for (const c of certs) {
    if (nowDate < c.notBefore) {
      errors.push(`证书 ${c.subjectCn || c.fingerprintSha256.slice(0, 11)} 尚未生效 (notBefore ${c.notBefore.toISOString()})`);
    }
    if (nowDate > c.notAfter) {
      errors.push(`证书 ${c.subjectCn || c.fingerprintSha256.slice(0, 11)} 已过期 (notAfter ${c.notAfter.toISOString()})`);
    }
  }

  const leaf = certs[0];
  if (leaf.isCa) {
    warnings.push('叶子证书带 CA=true，通常不应直接部署到业务节点');
  }

  for (let i = 1; i < certs.length; i++) {
    const child = certs[i - 1];
    const parent = certs[i];
    if (!parent.isCa) {
      errors.push(`链第 ${i + 1} 张 ${parent.subjectCn} 缺少 basicConstraints CA:TRUE，不能作为签发者`);
    }
    // issuer/subject DN match
    const childIssuerDn = child.cert.issuer.hash;
    const parentSubjectDn = parent.cert.subject.hash;
    if (childIssuerDn !== parentSubjectDn) {
      errors.push(
        `链断裂：${child.subjectCn} 的颁发者 (${child.issuerCn}) 与下一张证书主体 (${parent.subjectCn}) 不匹配`,
      );
      continue;
    }
    try {
      const verified = (parent.cert as any).verify?.(child.cert);
      if (verified === false) {
        errors.push(`签名校验失败：${parent.subjectCn} 未对 ${child.subjectCn} 形成有效签名`);
      }
    } catch (e) {
      errors.push(`签名校验异常 (${child.subjectCn} <- ${parent.subjectCn}): ${(e as Error).message}`);
    }
    if (parent.notBefore > child.notBefore || parent.notAfter < child.notAfter) {
      warnings.push(`中间/根证书 ${parent.subjectCn} 有效期未完全覆盖 ${child.subjectCn}`);
    }
  }

  const last = certs[certs.length - 1];
  if (certs.length > 1) {
    const selfSigned = last.cert.issuer.hash === last.cert.subject.hash;
    if (!selfSigned) {
      warnings.push('证书链未包含自签名根证书（可接受，但节点需信任缺失的根）');
    } else {
      try {
        const selfOk = (last.cert as any).verify?.(last.cert);
        if (selfOk === false) errors.push(`根证书 ${last.subjectCn} 自签名校验失败`);
      } catch {
        /* ignore */
      }
    }
  } else {
    warnings.push('只上传了单张叶子证书，缺少中间 CA 链');
  }

  return { valid: errors.length === 0, errors, warnings, certs, leaf };
}
