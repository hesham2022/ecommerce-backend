import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FileEntity } from '../entities/file.entity';
import { In, Repository } from 'typeorm';
import { FileRepository } from '../../file.repository';

import { FileMapper } from '../mappers/file.mapper';
import { FileType } from '../../../../domain/file';
import { NullableType } from '../../../../../utils/types/nullable.type';

@Injectable()
export class FileRelationalRepository implements FileRepository {
  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
  ) {}

  async create(data: FileType): Promise<FileType> {
    const persistenceModel = FileMapper.toPersistence(data);
    const entity = await this.fileRepository.save(
      this.fileRepository.create(persistenceModel),
    );

    return FileMapper.toDomain(entity);
  }

  async findById(id: FileType['id']): Promise<NullableType<FileType>> {
    const entity = await this.fileRepository.findOne({
      where: {
        id: id,
      },
    });

    return entity ? FileMapper.toDomain(entity) : null;
  }

  async findByIds(ids: FileType['id'][]): Promise<FileType[]> {
    const entities = await this.fileRepository.find({
      where: {
        id: In(ids),
      },
    });

    return entities.map((entity) => FileMapper.toDomain(entity));
  }

  async sumConfirmedBytesSince(input: {
    userId: number;
    purpose: string;
    since: Date;
  }): Promise<number> {
    const row = await this.fileRepository
      .createQueryBuilder('f')
      .select('COALESCE(SUM(f.size_bytes), 0)', 'sum')
      .where('f.user_id = :userId', { userId: input.userId })
      .andWhere('f.purpose = :purpose', { purpose: input.purpose })
      .andWhere('f.is_confirmed = true')
      .andWhere('f.created_at > :since', { since: input.since })
      .getRawOne<{ sum: string }>();
    return Number(row?.sum ?? 0);
  }

  async confirm(id: FileType['id']): Promise<FileType | null> {
    await this.fileRepository.update(
      { id },
      { isConfirmed: true, confirmedAt: new Date() },
    );
    return this.findById(id);
  }

  async updateVariants(
    id: FileType['id'],
    variants: Record<string, string>,
  ): Promise<FileType | null> {
    await this.fileRepository.update({ id }, { variants });
    return this.findById(id);
  }
}
