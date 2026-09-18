import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Certificate } from '../entities/certificate.entity';
import { Node } from '../entities/node.entity';
import { Deployment } from '../entities/deployment.entity';
import { DeploymentTask } from '../entities/deployment-task.entity';
import { NodeReceipt } from '../entities/node-receipt.entity';
import { SwitchLog } from '../entities/switch-log.entity';

export const ENTITIES = [
  Certificate,
  Node,
  Deployment,
  DeploymentTask,
  NodeReceipt,
  SwitchLog,
];

@Global()
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.PGHOST ?? '127.0.0.1',
      port: Number(process.env.PGPORT ?? 55444),
      username: process.env.PGUSER ?? 'postgres',
      password: process.env.PGPASSWORD ?? 'postgres',
      database: process.env.PGDATABASE ?? 'tls_rotation',
      entities: ENTITIES,
      synchronize: true,
      logging: false,
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
