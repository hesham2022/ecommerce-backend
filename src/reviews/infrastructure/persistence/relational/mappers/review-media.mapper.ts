import { instanceToPlain, plainToInstance } from 'class-transformer';
import { ReviewMedia } from '../../../../domain/review-media';
import { ReviewMediaEntity } from '../entities/review-media.entity';
import { FileType } from '../../../../../files/domain/file';

export class ReviewMediaMapper {
  /**
   * Build a domain ReviewMedia. We feed the file row through the existing
   * `FileType` transform pipeline so the resulting `url` matches whatever
   * driver the rest of the codebase is configured with (local prefix, S3,
   * presigned). When the driver is S3 the transform returns a Promise; in
   * that case we leave the raw key on `.url` (the same trade-off the rest
   * of the codebase makes when not awaiting `instanceToPlain`).
   */
  static toDomain(entity: ReviewMediaEntity): ReviewMedia {
    const d = new ReviewMedia();
    d.id = entity.id;
    d.reviewId = entity.reviewId;
    d.fileId = entity.fileId;
    d.position = entity.position;

    const rawPath = entity.file?.path ?? '';
    const fileForUrl = plainToInstance(FileType, {
      id: entity.fileId,
      path: rawPath,
    });
    const plain = instanceToPlain(fileForUrl) as { path?: unknown };
    d.url = typeof plain.path === 'string' ? plain.path : rawPath;
    return d;
  }
}
