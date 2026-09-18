import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES = join(__dirname, '..', '..', 'fixtures');

/** Generate the openssl fixtures once, then hand out PEM bundles. */
export function fixture(name: string): string {
  if (!existsSync(join(FIXTURES, name))) {
    execSync('bash scripts/gen-certs.sh', {
      cwd: join(__dirname, '..', '..'),
      stdio: 'inherit',
    });
  }
  return readFileSync(join(FIXTURES, name), 'utf8');
}
