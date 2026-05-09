import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { FilesPresignService } from './files-presign.service';
import { FileUploadDto } from './infrastructure/uploader/s3-presigned/dto/file.dto';

@ApiTags('Files')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'files', version: '1' })
export class FilesPresignController {
  constructor(private readonly presigns: FilesPresignService) {}

  @Post('presign')
  async presign(@Req() req: Request, @Body() dto: FileUploadDto) {
    const userId = (req.user as { id: number }).id;
    return this.presigns.presign(dto, userId);
  }

  @Post(':id/confirm')
  async confirm(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const userId = (req.user as { id: number }).id;
    return this.presigns.confirm(id, userId);
  }
}
