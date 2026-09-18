import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Node } from '../entities/node.entity';
import { Certificate } from '../entities/certificate.entity';
import { SwitchLog } from '../entities/switch-log.entity';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';

@Module({
  imports: [TypeOrmModule.forFeature([Node, Certificate, SwitchLog])],
  controllers: [NodesController],
  providers: [NodesService],
  exports: [NodesService],
})
export class NodesModule {}
