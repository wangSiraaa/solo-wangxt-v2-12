import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Node } from '../entities/node.entity';
import { Certificate } from '../entities/certificate.entity';
import { SimulatorService } from './simulator.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Node, Certificate])],
  providers: [SimulatorService],
  exports: [SimulatorService],
})
export class SimulatorModule {}
