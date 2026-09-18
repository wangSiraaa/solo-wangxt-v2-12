import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IsArray, IsNotEmpty, IsString } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Certificate } from '../entities';
import { analyzeBundle } from './cert-analysis';

class UploadCertDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  pem: string;

  /** Domains the platform expects this certificate to serve. */
  @IsArray()
  domains: string[];
}

class ValidateCertDto {
  @IsString()
  @IsNotEmpty()
  pem: string;

  @IsArray()
  domains: string[];
}

@Controller('api/certificates')
export class CertificatesController {
  constructor(
    @InjectRepository(Certificate)
    private readonly certs: Repository<Certificate>,
  ) {}

  @Get()
  async list(@Query('expiringWithinDays') expiringWithinDays?: string) {
    const all = await this.certs.find({ order: { notAfter: 'ASC' } });
    const now = Date.now();
    const withMeta = all.map((c) => ({
      ...c,
      pemBundle: undefined, // keep list payloads small
      daysLeft: Math.floor((c.notAfter.getTime() - now) / 86400000),
      expired: c.notAfter.getTime() < now,
    }));
    if (expiringWithinDays !== undefined) {
      const limit = Number(expiringWithinDays);
      return withMeta.filter((c) => c.daysLeft <= limit);
    }
    return withMeta;
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const cert = await this.certs.findOne({ where: { id } });
    if (!cert) throw new NotFoundException('certificate not found');
    return cert;
  }

  /** Dry-run validation so the UI can show problems before persisting. */
  @Post('validate')
  validate(@Body() dto: ValidateCertDto) {
    return analyzeBundle(dto.pem, { requiredDomains: dto.domains ?? [] });
  }

  @Post()
  async upload(@Body() dto: UploadCertDto) {
    const analysis = analyzeBundle(dto.pem, { requiredDomains: dto.domains });
    if (!analysis.ok || !analysis.leaf) {
      throw new BadRequestException({
        message: 'certificate validation failed',
        errors: analysis.errors,
        warnings: analysis.warnings,
      });
    }
    const entity = this.certs.create({
      name: dto.name,
      domains: dto.domains,
      sanDomains: analysis.leaf.sanDomains,
      pemBundle: dto.pem,
      fingerprint: analysis.leaf.fingerprint,
      chainFingerprints: analysis.chain.map((c) => c.fingerprint),
      serial: analysis.leaf.serial,
      issuer: analysis.leaf.issuer,
      subject: analysis.leaf.subject,
      notBefore: analysis.leaf.notBefore,
      notAfter: analysis.leaf.notAfter,
    });
    const saved = await this.certs.save(entity);
    return { certificate: saved, warnings: analysis.warnings };
  }
}
