import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { FilesS3PresignedService } from './files.service';
import { FileUploadDto } from './dto/file.dto';
import { FileResponseDto } from './dto/file-response.dto';

@ApiTags('Files')
@Controller({
  path: 'files',
  version: '1',
})
export class FilesS3PresignedController {
  constructor(private readonly filesService: FilesS3PresignedService) {}

  @ApiCreatedResponse({
    type: FileResponseDto,
  })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @Post('upload')
  async uploadFile(@Req() req: Request, @Body() file: FileUploadDto) {
    const userId = (req.user as { id: number }).id;
    return this.filesService.create(file, userId);
  }
}
