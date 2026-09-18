import { X509Certificate } from 'crypto';

export interface ChainLink {
  subject: string;
  issuer: string;
  fingerprint: string;
  notBefore: Date;
  notAfter: Date;
  selfSigned: boolean;
}

export interface CertAnalysis {
  ok: boolean;
  errors: string[];
  warnings: string[];
  leaf: {
    subject: string;
    issuer: string;
    serial: string;
    fingerprint: string;
    sanDomains: string[];
    notBefore: Date;
    notAfter: Date;
  } | null;
  chain: ChainLink[];
  coveredDomains: string[];
  missingDomains: string[];
}

export function fingerprintOf(cert: X509Certificate): string {
  // Normalise to the colon-separated form operators are used to seeing.
  return cert.fingerprint256.toUpperCase();
}

/** Split a PEM bundle into individual certificates, in file order. */
export function parsePemBundle(pem: string): X509Certificate[] {
  const matches = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
  );
  if (!matches || matches.length === 0) {
    throw new Error('No PEM certificate blocks found');
  }
  return matches.map((block) => new X509Certificate(block));
}

function cnOf(name: string): string | null {
  const m = name.match(/(?:^|\n)CN=([^\n]+)/);
  return m ? m[1].trim() : null;
}

/** Extract SAN dns entries, falling back to the subject CN. */
export function sanDomainsOf(cert: X509Certificate): string[] {
  const out: string[] = [];
  const san = cert.subjectAltName;
  if (san) {
    for (const part of san.split(',')) {
      const p = part.trim();
      if (p.startsWith('DNS:')) out.push(p.slice(4).trim().toLowerCase());
    }
  }
  if (out.length === 0) {
    const cn = cnOf(cert.subject);
    if (cn) out.push(cn.toLowerCase());
  }
  return [...new Set(out)];
}

/**
 * RFC 6125-style matching: a left-most wildcard `*.example.com` covers exactly
 * one label (`a.example.com`) but not `example.com` itself nor `a.b.example.com`.
 */
export function domainMatches(pattern: string, domain: string): boolean {
  const p = pattern.toLowerCase();
  const d = domain.toLowerCase();
  if (p === d) return true;
  if (p.startsWith('*.')) {
    const suffix = p.slice(2);
    if (!d.endsWith('.' + suffix)) return false;
    const head = d.slice(0, d.length - suffix.length - 1);
    return head.length > 0 && !head.includes('.');
  }
  return false;
}

export function coversDomain(sanDomains: string[], domain: string): boolean {
  return sanDomains.some((san) => domainMatches(san, domain));
}

export interface AnalyzeOptions {
  requiredDomains?: string[];
  now?: Date;
  /** Warn when the leaf expires within this many days. */
  expiryWarningDays?: number;
}

/**
 * Validate an uploaded bundle: leaf validity window, domain coverage against
 * the SAN list, and that each certificate is signed by the next one in the
 * bundle (chain integrity). The private key never enters this system.
 */
export function analyzeBundle(
  pem: string,
  opts: AnalyzeOptions = {},
): CertAnalysis {
  const errors: string[] = [];
  const warnings: string[] = [];
  const now = opts.now ?? new Date();
  const warnDays = opts.expiryWarningDays ?? 30;

  let certs: X509Certificate[];
  try {
    certs = parsePemBundle(pem);
  } catch (e) {
    return {
      ok: false,
      errors: [`Failed to parse PEM bundle: ${(e as Error).message}`],
      warnings,
      leaf: null,
      chain: [],
      coveredDomains: [],
      missingDomains: opts.requiredDomains ?? [],
    };
  }

  const leafCert = certs[0];
  const sanDomains = sanDomainsOf(leafCert);

  // --- validity window (leaf) ---
  const notBefore = new Date(leafCert.validFrom);
  const notAfter = new Date(leafCert.validTo);
  if (now < notBefore) {
    errors.push(`Certificate is not valid yet (valid from ${leafCert.validFrom})`);
  }
  if (now > notAfter) {
    errors.push(`Certificate expired on ${leafCert.validTo}`);
  } else {
    const daysLeft = (notAfter.getTime() - now.getTime()) / 86400000;
    if (daysLeft < warnDays) {
      warnings.push(
        `Certificate expires in ${Math.floor(daysLeft)} day(s) (${leafCert.validTo})`,
      );
    }
  }

  // --- domain coverage ---
  const required = opts.requiredDomains ?? [];
  const coveredDomains = required.filter((d) => coversDomain(sanDomains, d));
  const missingDomains = required.filter((d) => !coversDomain(sanDomains, d));
  for (const d of missingDomains) {
    errors.push(`Domain "${d}" is not covered by the certificate SAN list`);
  }

  // --- chain integrity: each cert must be issued & signed by the next ---
  const chain: ChainLink[] = [];
  for (let i = 0; i < certs.length; i++) {
    const c = certs[i];
    const selfSigned = c.issuer === c.subject && c.verify(c.publicKey);
    chain.push({
      subject: c.subject,
      issuer: c.issuer,
      fingerprint: fingerprintOf(c),
      notBefore: new Date(c.validFrom),
      notAfter: new Date(c.validTo),
      selfSigned,
    });
    if (i > 0) {
      const nb = new Date(c.validFrom);
      const na = new Date(c.validTo);
      if (now < nb || now > na) {
        errors.push(
          `Chain certificate #${i + 1} (${cnOf(c.subject) ?? c.subject}) is not currently valid`,
        );
      }
    }
    if (i + 1 < certs.length) {
      const issuer = certs[i + 1];
      if (c.issuer !== issuer.subject) {
        errors.push(
          `Chain broken at position ${i + 1}: issuer of "${cnOf(c.subject) ?? c.subject}" does not match subject of the next certificate`,
        );
      } else if (!c.verify(issuer.publicKey)) {
        errors.push(
          `Chain broken at position ${i + 1}: signature of "${cnOf(c.subject) ?? c.subject}" does not verify against the next certificate`,
        );
      }
    } else if (!selfSigned) {
      warnings.push(
        'Chain does not end with a self-signed root; the last certificate is expected to be trusted by clients directly',
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    leaf: {
      subject: leafCert.subject,
      issuer: leafCert.issuer,
      serial: leafCert.serialNumber,
      fingerprint: fingerprintOf(leafCert),
      sanDomains,
      notBefore,
      notAfter,
    },
    chain,
    coveredDomains,
    missingDomains,
  };
}
