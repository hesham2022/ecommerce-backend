import { ApiProperty } from '@nestjs/swagger';

export class ReviewMedia {
  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  id!: string;

  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  reviewId!: string;

  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  fileId!: string;

  @ApiProperty({
    example: 'https://example.com/uploads/abc.jpg',
    description: 'Resolved URL for the file (may be a presigned S3 link).',
  })
  url!: string;

  @ApiProperty({ example: 0 })
  position!: number;
}
