import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Certificate } from '../entities/certificate.entity';
import { Node } from '../entities/node.entity';
import { SwitchLog } from '../entities/switch-log.entity';
import { SeedService } from './seed.service';

@Module({
  imports: [TypeOrmModule.forFeature([Certificate, Node, SwitchLog])],
  providers: [SeedService],
})
export class SeedModule {}
