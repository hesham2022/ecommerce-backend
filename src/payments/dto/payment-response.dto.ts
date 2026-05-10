import { ApiProperty } from '@nestjs/swagger';
import { PaymentProviderName, PaymentStatus } from '../domain/payment-enums';
import { Payment } from '../domain/payment';

export class PaymentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty({ enum: PaymentProviderName }) provider!: PaymentProviderName;
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;
  @ApiProperty() amountMinor!: string;
  @ApiProperty() currencyCode!: string;
  @ApiProperty({ required: false, nullable: true })
  lastError!: string | null;

  static from(p: Payment): PaymentResponseDto {
    const dto = new PaymentResponseDto();
    dto.id = p.id;
    dto.orderId = p.orderId;
    dto.provider = p.provider;
    dto.status = p.status;
    dto.amountMinor = p.amountMinor;
    dto.currencyCode = p.currencyCode;
    dto.lastError = p.lastError;
    return dto;
  }
}
