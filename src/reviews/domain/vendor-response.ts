import { ApiProperty } from '@nestjs/swagger';

export class VendorResponse {
  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  id!: string;

  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  reviewId!: string;

  @ApiProperty({ example: 'Thanks for your feedback!' })
  body!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
