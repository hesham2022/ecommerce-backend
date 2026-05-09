import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';
import { Transform } from 'class-transformer';
import fileConfig from '../config/file.config';
import { FileConfig, FileDriver } from '../config/file-config.type';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfig } from '../../config/app-config.type';
import appConfig from '../../config/app.config';

export class FileType {
  @ApiProperty({
    type: String,
    example: 'cbcfa8b8-3a25-4adb-a9c6-e325f0d0f3ae',
  })
  @Allow()
  id: string;

  @ApiProperty({
    type: String,
    example: 'https://example.com/path/to/file.jpg',
  })
  @Transform(
    ({ value }) => {
      if ((fileConfig() as FileConfig).driver === FileDriver.LOCAL) {
        return (appConfig() as AppConfig).backendDomain + value;
      } else if (
        [FileDriver.S3_PRESIGNED, FileDriver.S3].includes(
          (fileConfig() as FileConfig).driver,
        )
      ) {
        const s3 = new S3Client({
          region: (fileConfig() as FileConfig).awsS3Region ?? '',
          credentials: {
            accessKeyId: (fileConfig() as FileConfig).accessKeyId ?? '',
            secretAccessKey: (fileConfig() as FileConfig).secretAccessKey ?? '',
          },
        });

        const command = new GetObjectCommand({
          Bucket: (fileConfig() as FileConfig).awsDefaultS3Bucket ?? '',
          Key: value,
        });

        return getSignedUrl(s3, command, { expiresIn: 3600 });
      }

      return value;
    },
    {
      toPlainOnly: true,
    },
  )
  path: string;

  @ApiProperty({ example: 42, nullable: true })
  @Allow()
  userId?: number | null;

  @ApiProperty({ example: 'chat-attachment', nullable: true })
  @Allow()
  purpose?: string | null;

  @ApiProperty({ example: 'image/jpeg', nullable: true })
  @Allow()
  mimeType?: string | null;

  @ApiProperty({ example: 138723, nullable: true })
  @Allow()
  sizeBytes?: number | null;

  @ApiProperty({ example: false })
  @Allow()
  isConfirmed?: boolean;

  @ApiProperty({ example: { thumb: 'a.thumb.jpg' }, nullable: true })
  @Allow()
  variants?: Record<string, string> | null;

  @ApiProperty({ nullable: true })
  @Allow()
  createdAt?: Date;

  @ApiProperty({ nullable: true })
  @Allow()
  confirmedAt?: Date | null;
}
