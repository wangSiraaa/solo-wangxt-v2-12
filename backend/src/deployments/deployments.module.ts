import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Deployment } from '../entities/deployment.entity';
import { DeploymentTask } from '../entities/deployment-task.entity';
import { Node } from '../entities/node.entity';
import { Certificate } from '../entities/certificate.entity';
import { NodeReceipt } from '../entities/node-receipt.entity';
import { SwitchLog } from '../entities/switch-log.entity';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Deployment,
      DeploymentTask,
      Node,
      Certificate,
      NodeReceipt,
      SwitchLog,
    ]),
  ],
  controllers: [DeploymentsController],
  providers: [DeploymentsService],
  exports: [DeploymentsService],
})
export class DeploymentsModule {}
