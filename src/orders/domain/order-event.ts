import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderEventType } from './order-enums';

export class OrderEvent {
  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  id!: string;

  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  subOrderId!: string;

  @ApiProperty({ enum: OrderEventType, example: OrderEventType.STATUS_CHANGED })
  eventType!: OrderEventType;

  @ApiPropertyOptional({ nullable: true, example: 'AWAITING_CONFIRMATION' })
  fromStatus!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'CONFIRMED' })
  toStatus!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 42 })
  actorUserId!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  payload!: Record<string, unknown> | null;

  @ApiProperty()
  createdAt!: Date;
}
