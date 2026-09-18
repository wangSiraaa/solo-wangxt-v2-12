import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PlansService } from './plans.service';

class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsUUID()
  certId: string;

  @IsOptional()
  @IsArray()
  nodeIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  canaryCount?: number;
}

class RollbackDto {
  @IsUUID()
  targetCertId: string;
}

@Controller('api/plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  list() {
    return this.plans.listPlans();
  }

  @Post()
  create(@Body() dto: CreatePlanDto) {
    return this.plans.createPlan(dto);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.plans.planDetail(id);
  }

  @Post(':id/start')
  start(@Param('id') id: string) {
    return this.plans.start(id);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.plans.approve(id);
  }

  @Post(':id/pause')
  pause(@Param('id') id: string) {
    return this.plans.pause(id);
  }

  @Post(':id/resume')
  resume(@Param('id') id: string) {
    return this.plans.resume(id);
  }

  @Get(':id/rollback-targets')
  rollbackTargets(@Param('id') id: string) {
    return this.plans.rollbackTargets(id);
  }

  @Post(':id/rollback')
  rollback(@Param('id') id: string, @Body() dto: RollbackDto) {
    return this.plans.rollback(id, dto.targetCertId);
  }
}
