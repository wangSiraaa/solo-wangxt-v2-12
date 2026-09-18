import { Module } from '@nestjs/common';
import { DatabaseModule } from './common/database.module';
import { SimulatorModule } from './simulator/simulator.module';
import { CertificatesModule } from './certificates/certificates.module';
import { NodesModule } from './nodes/nodes.module';
import { DeploymentsModule } from './deployments/deployments.module';
import { SeedModule } from './seed/seed.module';

@Module({
  imports: [
    DatabaseModule,
    SimulatorModule,
    CertificatesModule,
    NodesModule,
    DeploymentsModule,
    SeedModule,
  ],
})
export class AppModule {}
