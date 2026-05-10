import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { OrderPaymentMethod } from '../domain/order-enums';
import { PaymentProviderName } from '../../payments/domain/payment-enums';
import { AddressDto } from './address.dto';

export class PlaceOrderDto {
  @ApiProperty({ type: () => AddressDto })
  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;

  @ApiProperty({ enum: OrderPaymentMethod, example: OrderPaymentMethod.COD })
  @IsEnum(OrderPaymentMethod)
  paymentMethod!: OrderPaymentMethod;

  @ApiPropertyOptional({
    enum: PaymentProviderName,
    description:
      'Required when paymentMethod is CARD. Selects the gateway adapter.',
  })
  @IsOptional()
  @IsEnum(PaymentProviderName)
  paymentProvider?: PaymentProviderName;
}
