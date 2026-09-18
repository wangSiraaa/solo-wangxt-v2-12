import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { IsOptional, IsString, IsUUID, IsArray } from 'class-validator';
import { DeploymentsService } from './deployments.service';

class CreateDeploymentDto {
  @IsUUID()
  certId: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class RollbackDto {
  @IsOptional()
  @IsUUID()
  certId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  nodeIds?: string[];
}

@Controller('deployments')
export class DeploymentsController {
  constructor(private readonly service: DeploymentsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() dto: CreateDeploymentDto) {
    return this.service.create(dto.certId, dto.note);
  }

  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.detail(id);
  }

  @Post(':id/start')
  start(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.start(id);
  }

  @Post(':id/pause')
  pause(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.pause(id);
  }

  @Post(':id/promote')
  promote(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.promote(id);
  }

  @Post(':id/retry')
  retry(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.retryBatch(id);
  }

  @Get(':id/rollback-candidates')
  candidates(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.rollbackCandidates(id);
  }

  @Post(':id/rollback')
  rollback(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RollbackDto,
  ) {
    return this.service.rollback(id, dto.certId, dto.nodeIds);
  }
}
