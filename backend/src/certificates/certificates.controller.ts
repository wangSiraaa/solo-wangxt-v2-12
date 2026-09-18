import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  Body,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CertificatesService } from './certificates.service';
import { CertValidationError } from './cert-utils';

function translate(e: unknown): never {
  if (e instanceof CertValidationError) {
    const payload = { message: e.message, details: e.details };
    if ((e as any).conflict) throw new ConflictException(payload);
    throw new UnprocessableEntityException(payload);
  }
  throw e;
}

@Controller('certificates')
export class CertificatesController {
  constructor(private readonly service: CertificatesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get('expiring')
  expiring(@Query('withinDays') withinDays?: string) {
    return this.service.expiring(
      withinDays ? Math.max(1, Number(withinDays) || 30) : 30,
    );
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id).catch((e) => {
      throw e;
    });
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('chain'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('label') label?: string,
    @Body('pem') pem?: string,
  ) {
    const raw = file ? file.buffer.toString('utf8') : pem ?? '';
    if (!raw.trim()) {
      throw new BadRequestException({
        message: '缺少证书内容',
        details: ['请上传 chain 文件或粘贴 PEM'],
      });
    }
    try {
      return await this.service.upload(
        raw,
        label?.trim() || '',
        file?.originalname ?? null,
      );
    } catch (e) {
      translate(e);
    }
  }
}
