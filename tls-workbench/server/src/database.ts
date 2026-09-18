import { DataSource, DataSourceOptions } from 'typeorm';
import {
  Assignment,
  Certificate,
  NodeEntity,
  Plan,
  SwitchRecord,
} from './entities';

const entities = [Certificate, NodeEntity, Plan, Assignment, SwitchRecord];

/**
 * Production runs on PostgreSQL (see docker-compose.yml). For local
 * development and CI without a database server, set DB_TYPE=sqljs to use an
 * embedded SQLite-compatible file instead.
 */
export function buildDataSourceOptions(): DataSourceOptions {
  const type = process.env.DB_TYPE || 'postgres';
  if (type === 'sqljs') {
    return {
      type: 'sqljs',
      location: process.env.DB_LOCATION || 'data/workbench.db',
      autoSave: true,
      entities,
      synchronize: true,
      logging: false,
    } as DataSourceOptions;
  }
  return {
    type: 'postgres',
    url:
      process.env.DATABASE_URL ||
      'postgres://postgres:postgres@localhost:5432/tls_workbench',
    entities,
    synchronize: true,
    logging: false,
  };
}

export const AppDataSource = new DataSource(buildDataSourceOptions());
