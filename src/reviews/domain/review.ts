import { ApiProperty } from '@nestjs/swagger';
import { ReviewStatus } from './review-status';
import { ReviewMedia } from './review-media';
import { VendorResponse } from './vendor-response';

export class Review {
  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  id!: string;

  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  orderItemId!: string;

  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  productId!: string;

  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  vendorId!: string;

  @ApiProperty({ example: 42 })
  buyerId!: number;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  rating!: number;

  @ApiProperty({ example: 'Great quality, fast shipping.' })
  body!: string;

  @ApiProperty({ enum: ReviewStatus, example: ReviewStatus.PUBLISHED })
  status!: ReviewStatus;

  @ApiProperty({ type: () => [ReviewMedia] })
  media!: ReviewMedia[];

  @ApiProperty({ type: () => VendorResponse, nullable: true })
  vendorResponse!: VendorResponse | null;

  @ApiProperty({ example: 'jane.doe@example.com', nullable: true })
  buyerDisplayName!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
