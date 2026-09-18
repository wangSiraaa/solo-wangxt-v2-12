import * as path from 'path';
import * as fs from 'fs';
import * as forge from 'node-forge';

/**
 * Generates demo PKI material into ../samples:
 *  - demo root CA + intermediate CA
 *  - current cert (valid, ~397d)
 *  - expiring cert (valid ~18d)
 *  - expired cert
 *  - wildcard cert (*.example.com)
 *  - unrelated-domain cert (should be rejected on upload)
 *  - broken chain (leaf signed by a DIFFERENT CA, chain attached anyway)
 *  - a private key file (must be rejected / never imported)
 */
const samplesDir = path.resolve(__dirname, '..', '..', 'samples');
fs.mkdirSync(samplesDir, { recursive: true });

function ca(commonName: string, years: number) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = 'a' + Math.floor(Math.random() * 0xfffffffffffffff).toString(16).padStart(15, '0');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * years);
  cert.setSubject([{ name: 'commonName', value: commonName }]);
  cert.setIssuer([{ name: 'commonName', value: commonName }]);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, cRLSign: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert, keys };
}

function leaf(opts: {
  cn: string;
  sans: string[];
  issuer: { cert: forge.pki.Certificate; keys: forge.pki.rsa.KeyPair };
  notBefore: Date;
  notAfter: Date;
}) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = 'a' + Math.floor(Math.random() * 0xfffffffffffffff).toString(16).padStart(15, '0');
  cert.validity.notBefore = opts.notBefore;
  cert.validity.notAfter = opts.notAfter;
  cert.setSubject([{ name: 'commonName', value: opts.cn }]);
  cert.setIssuer(opts.issuer.cert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'subjectAltName',
      altNames: opts.sans.map((v) => ({ type: 2, value: v })),
    },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
  ]);
  cert.sign(opts.issuer.keys.privateKey, forge.md.sha256.create());
  return { cert, keys };
}

const pem = (c: forge.pki.Certificate) =>
  forge.pki.certificateToPem(c).trim();

const day = 86_400_000;

const root = ca('Demo Root CA', 10);
const interKeys = forge.pki.rsa.generateKeyPair(2048);
const intermediate = forge.pki.createCertificate();
intermediate.publicKey = interKeys.publicKey;
intermediate.serialNumber = '2a0b0c0d0e0f1122';
intermediate.validity.notBefore = new Date();
intermediate.validity.notAfter = new Date(Date.now() + day * 365 * 5);
intermediate.setSubject([{ name: 'commonName', value: 'Demo Intermediate CA' }]);
intermediate.setIssuer(root.cert.subject.attributes);
intermediate.setExtensions([
  { name: 'basicConstraints', cA: true },
  { name: 'keyUsage', keyCertSign: true, digitalSignature: true, cRLSign: true },
]);
intermediate.sign(root.keys.privateKey, forge.md.sha256.create());
const inter = { cert: intermediate, keys: interKeys };

// separate CA used to construct a broken chain sample
const rogue = ca('Rogue Other Root CA', 10);

const nowT = Date.now();
const current = leaf({
  cn: 'api.example.com',
  sans: ['api.example.com', 'www.example.com'],
  issuer: inter,
  notBefore: new Date(nowT - day * 30),
  notAfter: new Date(nowT + day * 397),
});
const expiring = leaf({
  cn: 'api.example.com',
  sans: ['api.example.com', 'www.example.com'],
  issuer: inter,
  notBefore: new Date(nowT - day * 80),
  notAfter: new Date(nowT + day * 18),
});
const expired = leaf({
  cn: 'api.example.com',
  sans: ['api.example.com'],
  issuer: inter,
  notBefore: new Date(nowT - day * 400),
  notAfter: new Date(nowT - day * 5),
});
const wildcard = leaf({
  cn: '*.example.com',
  sans: ['*.example.com'],
  issuer: inter,
  notBefore: new Date(nowT - day * 10),
  notAfter: new Date(nowT + day * 365),
});
const unrelated = leaf({
  cn: 'shop.somewhere-else.net',
  sans: ['shop.somewhere-else.net'],
  issuer: inter,
  notBefore: new Date(nowT - day * 5),
  notAfter: new Date(nowT + day * 90),
});
// leaf signed by rogue, but chain wrongly attaches demo intermediate/root
const broken = leaf({
  cn: 'api.example.com',
  sans: ['api.example.com'],
  issuer: rogue,
  notBefore: new Date(nowT - day * 5),
  notAfter: new Date(nowT + day * 90),
});

const write = (name: string, content: string) => {
  fs.writeFileSync(path.join(samplesDir, name), content + '\n');
  console.log('wrote', name);
};

write('root-ca.pem', pem(root.cert));
write('intermediate-ca.pem', pem(inter.cert));
write('current-chain.pem', [pem(current.cert), pem(inter.cert), pem(root.cert)].join('\n\n'));
write('expiring-chain.pem', [pem(expiring.cert), pem(inter.cert), pem(root.cert)].join('\n\n'));
write('expired-chain.pem', [pem(expired.cert), pem(inter.cert), pem(root.cert)].join('\n\n'));
write('wildcard-chain.pem', [pem(wildcard.cert), pem(inter.cert), pem(root.cert)].join('\n\n'));
write('unrelated-domain-chain.pem', [pem(unrelated.cert), pem(inter.cert), pem(root.cert)].join('\n\n'));
write('broken-chain.pem', [pem(broken.cert), pem(inter.cert), pem(root.cert)].join('\n\n'));
write('forbidden-private.key', forge.pki.privateKeyToPem(current.keys.privateKey).trim());
