import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from './database';
import {
  Assignment,
  Certificate,
  NodeEntity,
  Plan,
  SwitchRecord,
} from './entities';
import { CertificatesController } from './certificates/certificates.controller';
import { NodesController } from './nodes/nodes.controller';
import { PlansController } from './plans/plans.controller';
import { PlansService } from './plans/plans.service';
import { AgentController } from './agent/agent.controller';

@Module({
  imports: [
    TypeOrmModule.forRoot(buildDataSourceOptions()),
    TypeOrmModule.forFeature([
      Certificate,
      NodeEntity,
      Plan,
      Assignment,
      SwitchRecord,
    ]),
  ],
  controllers: [
    CertificatesController,
    NodesController,
    PlansController,
    AgentController,
  ],
  providers: [
    PlansService,
    { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true }) },
  ],
})
export class AppModule {}
