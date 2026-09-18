import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NodeEntity, SwitchRecord } from '../entities';

class CreateNodeDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(['canary', 'prod'])
  role: 'canary' | 'prod';
}

@Controller('api/nodes')
export class NodesController {
  constructor(
    @InjectRepository(NodeEntity)
    private readonly nodes: Repository<NodeEntity>,
    @InjectRepository(SwitchRecord)
    private readonly switches: Repository<SwitchRecord>,
  ) {}

  @Get()
  list() {
    return this.nodes.find({ order: { name: 'ASC' } });
  }

  @Post()
  async create(@Body() dto: CreateNodeDto) {
    const existing = await this.nodes.findOne({ where: { name: dto.name } });
    if (existing) return existing;
    return this.nodes.save(this.nodes.create(dto));
  }

  /** Switch history of a single node — the audit trail of versions it ran. */
  @Get(':id/history')
  async history(@Param('id') id: string) {
    const node = await this.nodes.findOne({ where: { id } });
    if (!node) throw new NotFoundException('node not found');
    return this.switches.find({
      where: { nodeId: id },
      order: { createdAt: 'DESC' },
    });
  }
}
