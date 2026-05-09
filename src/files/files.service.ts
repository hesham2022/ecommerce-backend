import { Injectable } from '@nestjs/common';

import { FileRepository } from './infrastructure/persistence/file.repository';
import { FileType } from './domain/file';
import { NullableType } from '../utils/types/nullable.type';

@Injectable()
export class FilesService {
  constructor(private readonly fileRepository: FileRepository) {}

  findById(id: FileType['id']): Promise<NullableType<FileType>> {
    return this.fileRepository.findById(id);
  }

  findByIds(ids: FileType['id'][]): Promise<FileType[]> {
    return this.fileRepository.findByIds(ids);
  }

  sumConfirmedBytesSince(input: {
    userId: number;
    purpose: string;
    since: Date;
  }): Promise<number> {
    return this.fileRepository.sumConfirmedBytesSince(input);
  }

  confirm(id: FileType['id']): Promise<NullableType<FileType>> {
    return this.fileRepository.confirm(id);
  }

  updateVariants(
    id: FileType['id'],
    variants: Record<string, string>,
  ): Promise<NullableType<FileType>> {
    return this.fileRepository.updateVariants(id, variants);
  }
}
