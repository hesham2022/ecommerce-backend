import { FileType } from '../../../../domain/file';
import { FileEntity } from '../entities/file.entity';

export class FileMapper {
  static toDomain(raw: FileEntity): FileType {
    const domainEntity = new FileType();
    domainEntity.id = raw.id;
    domainEntity.path = raw.path;
    domainEntity.userId = raw.userId ?? null;
    domainEntity.purpose = raw.purpose ?? null;
    domainEntity.mimeType = raw.mimeType ?? null;
    domainEntity.sizeBytes =
      raw.sizeBytes === null || raw.sizeBytes === undefined
        ? null
        : Number(raw.sizeBytes);
    domainEntity.isConfirmed = raw.isConfirmed ?? false;
    domainEntity.variants = raw.variants ?? null;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.confirmedAt = raw.confirmedAt ?? null;
    return domainEntity;
  }

  static toPersistence(domainEntity: FileType): FileEntity {
    const persistenceEntity = new FileEntity();
    persistenceEntity.id = domainEntity.id;
    persistenceEntity.path = domainEntity.path;
    persistenceEntity.userId = domainEntity.userId ?? null;
    persistenceEntity.purpose = domainEntity.purpose ?? null;
    persistenceEntity.mimeType = domainEntity.mimeType ?? null;
    persistenceEntity.sizeBytes = domainEntity.sizeBytes ?? null;
    persistenceEntity.isConfirmed = domainEntity.isConfirmed ?? false;
    persistenceEntity.variants = domainEntity.variants ?? null;
    persistenceEntity.createdAt = domainEntity.createdAt ?? new Date();
    persistenceEntity.confirmedAt = domainEntity.confirmedAt ?? null;
    return persistenceEntity;
  }
}
