import { ApiProperty } from '@nestjs/swagger';

export class UserBlock {
  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  id!: string;

  @ApiProperty({ example: 1 })
  blockerUserId!: number;

  @ApiProperty({ example: 2 })
  blockedUserId!: number;

  @ApiProperty()
  createdAt!: Date;
}
