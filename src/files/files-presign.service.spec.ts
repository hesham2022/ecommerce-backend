import { UnprocessableEntityException } from '@nestjs/common';
import { FilesPresignService } from './files-presign.service';
import { CHAT_ATTACHMENT_PURPOSE } from './infrastructure/uploader/s3-presigned/dto/file.dto';

describe('FilesPresignService', () => {
  const makeService = (repoOverrides = {}) => {
    const repo = {
      create: jest.fn(),
      findById: jest.fn(),
      sumConfirmedBytesSince: jest.fn(),
      confirm: jest.fn(),
      ...repoOverrides,
    };
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'file.maxFileSize') return 5 * 1024 * 1024;
        return undefined;
      }),
      getOrThrow: jest.fn(),
    };
    return {
      repo,
      service: new FilesPresignService(repo as never, config as never),
    };
  };

  it('should allow five 20MB chat attachments under the daily quota', async () => {
    const size = 20 * 1024 * 1024;
    const { service } = makeService({
      findById: jest.fn().mockResolvedValue({
        id: 'file-id',
        userId: 1,
        purpose: CHAT_ATTACHMENT_PURPOSE,
        mimeType: 'image/jpeg',
        sizeBytes: size,
      }),
      sumConfirmedBytesSince: jest.fn().mockResolvedValue(80 * 1024 * 1024),
      confirm: jest.fn().mockResolvedValue({ id: 'file-id' }),
    });

    await expect(service.confirm('file-id', 1)).resolves.toEqual({
      file: { id: 'file-id' },
    });
  });

  it('should reject when confirming would exceed the 100MB daily quota', async () => {
    const size = 20 * 1024 * 1024;
    const { service } = makeService({
      findById: jest.fn().mockResolvedValue({
        id: 'file-id',
        userId: 1,
        purpose: CHAT_ATTACHMENT_PURPOSE,
        mimeType: 'image/jpeg',
        sizeBytes: size,
      }),
      sumConfirmedBytesSince: jest.fn().mockResolvedValue(100 * 1024 * 1024),
    });

    await expect(service.confirm('file-id', 1)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });
});
