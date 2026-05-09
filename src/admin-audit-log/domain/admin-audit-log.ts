import { ApiProperty } from '@nestjs/swagger';

export class AdminAuditLog {
  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  id!: string;

  @ApiProperty({ example: 1 })
  adminUserId!: number;

  @ApiProperty({ example: 'CONVERSATION_REPORT_RESOLVE' })
  action!: string;

  @ApiProperty({ example: 'conversation_report' })
  targetType!: string;

  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  targetId!: string;

  @ApiProperty()
  payload!: Record<string, unknown>;

  @ApiProperty()
  createdAt!: Date;
}
