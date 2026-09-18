import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { NodesService } from './nodes.service';

export class UpdateNodeDto {
  @IsOptional()
  @IsIn(['normal', 'fail', 'flaky', 'timeout', 'duplicate'])
  simMode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  baseDelayMs?: number;

  @IsOptional()
  @IsString()
  region?: string;
}

@Controller('nodes')
export class NodesController {
  constructor(private readonly service: NodesService) {}

  /** node × cert matrix, incl. control-plane vs real node fingerprint */
  @Get('matrix')
  matrix() {
    return this.service.matrix();
  }

  @Get('switch-log')
  switchLog() {
    return this.service.switchLog();
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateNodeDto,
  ) {
    return this.service.update(id, dto);
  }

  /** manually inject a one-shot failure for demo purposes */
  @Post(':id/force-fail')
  forceFail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.forceFail(id);
  }
}
