/**
 * Seed the workbench with demo nodes and certificates.
 * Requires the API to be running (default http://localhost:3000).
 *
 *   npm run seed
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SERVER = process.env.SERVER ?? 'http://localhost:3000';
const FIXTURES = join(__dirname, '..', 'fixtures');

async function post(path: string, body: unknown) {
  const res = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    console.log(`POST ${path} -> ${res.status}`, JSON.stringify(json));
  }
  return json;
}

async function main() {
  const nodes = [
    { name: 'canary-1', role: 'canary' },
    { name: 'canary-2', role: 'canary' },
    { name: 'prod-1', role: 'prod' },
    { name: 'prod-2', role: 'prod' },
    { name: 'prod-3', role: 'prod' },
    { name: 'prod-4', role: 'prod' },
  ];
  for (const n of nodes) await post('/api/nodes', n);
  console.log(`nodes: ${nodes.map((n) => n.name).join(', ')}`);

  const domains = ['api.example.com', 'www.example.com'];
  const certs = [
    { name: 'valid-2026', file: 'valid.pem', domains },
    { name: 'expiring-soon', file: 'expiring.pem', domains },
  ];
  for (const c of certs) {
    const pem = readFileSync(join(FIXTURES, c.file), 'utf8');
    const res = await post('/api/certificates', {
      name: c.name,
      pem,
      domains: c.domains,
    });
    if (res.certificate) {
      console.log(
        `cert "${c.name}" uploaded, fingerprint ${res.certificate.fingerprint.slice(0, 23)}…`,
      );
    }
  }
}

void main();
