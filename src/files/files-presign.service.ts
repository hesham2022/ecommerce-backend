import {
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import { AllConfigType } from '../config/config.type';
import { FileType } from './domain/file';
import { FileRepository } from './infrastructure/persistence/file.repository';
import {
  CHAT_ATTACHMENT_MIME_WHITELIST,
  CHAT_ATTACHMENT_PURPOSE,
  FileUploadDto,
} from './infrastructure/uploader/s3-presigned/dto/file.dto';

@Injectable()
export class FilesPresignService {
  private readonly s3: S3Client;
  private readonly chatAttachmentMaxBytes = 25 * 1024 * 1024;
  private readonly chatAttachmentDailyQuotaBytes = 100 * 1024 * 1024;

  constructor(
    private readonly fileRepository: FileRepository,
    private readonly config: ConfigService<AllConfigType>,
  ) {
    this.s3 = new S3Client({
      region:
        this.config.get('file.awsS3Region', { infer: true }) || 'us-east-1',
      credentials: this.hasS3Config()
        ? {
            accessKeyId: this.config.getOrThrow('file.accessKeyId', {
              infer: true,
            }),
            secretAccessKey: this.config.getOrThrow('file.secretAccessKey', {
              infer: true,
            }),
          }
        : undefined,
    });
  }

  async presign(
    file: FileUploadDto,
    userId: number,
  ): Promise<{ fileId: string; uploadUrl: string }> {
    const purpose = file.purpose ?? 'general';
    const isChatAttachment = purpose === CHAT_ATTACHMENT_PURPOSE;
    const mimeType = file.mimeType ?? this.inferMimeType(file.fileName);
    if (isChatAttachment) {
      this.assertChatAttachmentMetadata(file.fileSize, mimeType);
    } else {
      const max = this.config.get('file.maxFileSize', { infer: true }) || 0;
      if (file.fileSize > max) {
        throw new PayloadTooLargeException('File too large');
      }
    }

    const key = `${randomStringGenerator()}.${file.fileName
      .split('.')
      .pop()
      ?.toLowerCase()}`;
    const created = await this.fileRepository.create({
      path: key,
      userId,
      purpose,
      mimeType,
      sizeBytes: file.fileSize,
      isConfirmed: false,
      variants: null,
      createdAt: new Date(),
      confirmedAt: null,
    });

    return {
      fileId: created.id,
      uploadUrl: await this.buildUploadUrl(key, file.fileSize, mimeType),
    };
  }

  async confirm(fileId: string, userId: number): Promise<{ file: FileType }> {
    const file = await this.fileRepository.findById(fileId);
    if (!file) throw new NotFoundException('File not found');
    if (file.userId !== userId) {
      throw new UnprocessableEntityException('file_not_owned_by_user');
    }
    if (file.purpose === CHAT_ATTACHMENT_PURPOSE) {
      this.assertChatAttachmentMetadata(file.sizeBytes ?? 0, file.mimeType);
      const used = await this.fileRepository.sumConfirmedBytesSince({
        userId,
        purpose: CHAT_ATTACHMENT_PURPOSE,
        since: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      if (used + (file.sizeBytes ?? 0) > this.chatAttachmentDailyQuotaBytes) {
        throw new UnprocessableEntityException('attachment_quota_exceeded');
      }
    }
    return { file: (await this.fileRepository.confirm(fileId)) ?? file };
  }

  private async buildUploadUrl(
    key: string,
    fileSize: number,
    mimeType: string,
  ): Promise<string> {
    if (!this.hasS3Config()) {
      return `/files/presigned/${key}`;
    }
    const command = new PutObjectCommand({
      Bucket: this.config.getOrThrow('file.awsDefaultS3Bucket', {
        infer: true,
      }),
      Key: key,
      ContentLength: fileSize,
      ContentType: mimeType,
    });
    return getSignedUrl(this.s3, command, { expiresIn: 3600 });
  }

  private hasS3Config(): boolean {
    return Boolean(
      this.config.get('file.accessKeyId', { infer: true }) &&
      this.config.get('file.secretAccessKey', { infer: true }) &&
      this.config.get('file.awsDefaultS3Bucket', { infer: true }),
    );
  }

  private assertChatAttachmentMetadata(
    fileSize: number,
    mimeType?: string | null,
  ): void {
    if (fileSize > this.chatAttachmentMaxBytes) {
      throw new UnprocessableEntityException('attachment_file_too_large');
    }
    if (
      !mimeType ||
      !CHAT_ATTACHMENT_MIME_WHITELIST.includes(
        mimeType as (typeof CHAT_ATTACHMENT_MIME_WHITELIST)[number],
      )
    ) {
      throw new UnprocessableEntityException('attachment_mime_not_allowed');
    }
  }

  private inferMimeType(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'pdf':
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
  }
}
