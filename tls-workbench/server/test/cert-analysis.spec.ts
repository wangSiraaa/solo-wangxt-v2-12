import { describe, expect, it } from 'vitest';
import {
  analyzeBundle,
  coversDomain,
  domainMatches,
} from '../src/certificates/cert-analysis';
import { fixture } from './helpers';

const DOMAINS = ['api.example.com', 'www.example.com'];

describe('domainMatches', () => {
  it('matches exact names', () => {
    expect(domainMatches('api.example.com', 'api.example.com')).toBe(true);
    expect(domainMatches('api.example.com', 'API.Example.COM')).toBe(true);
    expect(domainMatches('api.example.com', 'web.example.com')).toBe(false);
  });

  it('matches a single wildcard label only', () => {
    expect(domainMatches('*.example.com', 'www.example.com')).toBe(true);
    expect(domainMatches('*.example.com', 'example.com')).toBe(false);
    expect(domainMatches('*.example.com', 'a.b.example.com')).toBe(false);
    expect(domainMatches('*.example.com', 'example.com.evil.org')).toBe(false);
  });

  it('coversDomain checks a SAN list', () => {
    const san = ['api.example.com', '*.example.com'];
    expect(coversDomain(san, 'www.example.com')).toBe(true);
    expect(coversDomain(san, 'other.org')).toBe(false);
  });
});

describe('analyzeBundle', () => {
  it('accepts a valid bundle and reports chain + coverage', () => {
    const r = analyzeBundle(fixture('valid.pem'), { requiredDomains: DOMAINS });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.leaf!.sanDomains).toContain('api.example.com');
    expect(r.missingDomains).toEqual([]);
    expect(r.coveredDomains.sort()).toEqual([...DOMAINS].sort());
    expect(r.chain).toHaveLength(2); // leaf + root
    expect(r.chain[1].selfSigned).toBe(true);
    expect(r.leaf!.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it('rejects an expired certificate', () => {
    const r = analyzeBundle(fixture('expired.pem'), { requiredDomains: DOMAINS });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/expired/i);
  });

  it('rejects a certificate that does not cover the required domains', () => {
    const r = analyzeBundle(fixture('wrong-domain.pem'), {
      requiredDomains: DOMAINS,
    });
    expect(r.ok).toBe(false);
    expect(r.missingDomains.sort()).toEqual([...DOMAINS].sort());
    expect(r.errors.join(' ')).toMatch(/not covered/);
  });

  it('rejects a broken chain (unrelated CA appended)', () => {
    const r = analyzeBundle(fixture('broken-chain.pem'), {
      requiredDomains: DOMAINS,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Chain broken/);
  });

  it('warns when expiry is near', () => {
    const r = analyzeBundle(fixture('expiring.pem'), { requiredDomains: ['api.example.com'] });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/expires in/);
  });

  it('fails cleanly on garbage input', () => {
    const r = analyzeBundle('not a pem at all');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Failed to parse/);
  });
});
