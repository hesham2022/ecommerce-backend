import { NullableType } from '../../../utils/types/nullable.type';
import { FileType } from '../../domain/file';

export abstract class FileRepository {
  abstract create(data: Omit<FileType, 'id'>): Promise<FileType>;

  abstract findById(id: FileType['id']): Promise<NullableType<FileType>>;

  abstract findByIds(ids: FileType['id'][]): Promise<FileType[]>;

  abstract sumConfirmedBytesSince(input: {
    userId: number;
    purpose: string;
    since: Date;
  }): Promise<number>;

  abstract confirm(id: FileType['id']): Promise<FileType | null>;

  abstract updateVariants(
    id: FileType['id'],
    variants: Record<string, string>,
  ): Promise<FileType | null>;
}
