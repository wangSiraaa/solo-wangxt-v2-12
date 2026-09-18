import * as fs from 'fs';
import * as path from 'path';

/**
 * Zero-dependency local PostgreSQL: the platform binary comes via the
 * optional dep and runs `initdb`/`postgres` under .pgdata. For a real
 * deployment use docker-compose / an external PG and skip this script.
 */
async function main() {
  // embedded-postgres is ESM-only — load via dynamic import from this CJS script
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  const port = Number(process.env.PGPORT ?? 55444);
  const dataDir = `${process.cwd()}/.pgdata`;
  const alreadyInit = fs.existsSync(path.join(dataDir, 'PG_VERSION'));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
    initdbFlags: [],
    postgresFlags: [],
  });

  if (!alreadyInit) await pg.initialise();
  await pg.start();
  await pg.createDatabase('tls_rotation').catch((e: { code?: string }) => {
    // 42P04 = duplicate_database — fine on persistent restart
    if (e?.code !== '42P04') throw e;
  });
  console.log(`[dev-pg] ready on 127.0.0.1:${port} (db=tls_rotation)`);

  const shutdown = async () => {
    console.log('\n[dev-pg] stopping...');
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
