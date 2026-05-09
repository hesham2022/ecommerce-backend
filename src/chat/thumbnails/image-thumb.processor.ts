import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Job } from 'bullmq';
import sharp from 'sharp';
import { AllConfigType } from '../../config/config.type';
import { FilesService } from '../../files/files.service';

@Injectable()
@Processor('image-thumb')
export class ImageThumbProcessor extends WorkerHost {
  private readonly log = new Logger(ImageThumbProcessor.name);
  private readonly s3: S3Client;

  constructor(
    private readonly files: FilesService,
    private readonly config: ConfigService<AllConfigType>,
  ) {
    super();
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

  async process(job: Job<{ fileId: string }>): Promise<void> {
    const file = await this.files.findById(job.data.fileId);
    if (!file?.path || !file.mimeType?.startsWith('image/')) return;
    if (!this.hasS3Config()) {
      this.log.warn(
        'Skipping thumbnail generation because S3 is not configured',
      );
      return;
    }

    const bucket = this.config.getOrThrow('file.awsDefaultS3Bucket', {
      infer: true,
    });
    const original = await this.s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: file.path }),
    );
    const source = await original.Body?.transformToByteArray();
    if (!source) return;

    const thumbKey = `${file.path}.thumb.jpg`;
    const mediumKey = `${file.path}.medium.jpg`;
    const [thumb, medium] = await Promise.all([
      sharp(source)
        .resize(256, 256, { fit: 'cover' })
        .jpeg({ quality: 82 })
        .toBuffer(),
      sharp(source)
        .resize({ width: 1024, height: 1024, fit: 'inside' })
        .jpeg({ quality: 86 })
        .toBuffer(),
    ]);

    await Promise.all([
      this.s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: thumbKey,
          Body: thumb,
          ContentType: 'image/jpeg',
        }),
      ),
      this.s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: mediumKey,
          Body: medium,
          ContentType: 'image/jpeg',
        }),
      ),
    ]);
    await this.files.updateVariants(file.id, {
      ...(file.variants ?? {}),
      thumb: thumbKey,
      medium: mediumKey,
    });
  }

  private hasS3Config(): boolean {
    return Boolean(
      this.config.get('file.accessKeyId', { infer: true }) &&
      this.config.get('file.secretAccessKey', { infer: true }) &&
      this.config.get('file.awsDefaultS3Bucket', { infer: true }),
    );
  }
}
