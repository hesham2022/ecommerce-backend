import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { OrdersService } from '../orders/orders.service';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Buyer · Payments')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
  ) {}

  @Get(':id')
  @ApiOkResponse({ type: PaymentResponseDto })
  async findById(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<PaymentResponseDto> {
    const userId = (req.user as { id: number }).id;
    const payment = await this.payments.findById(id);
    // Ownership check: confirms the requester owns the parent order.
    // OrdersService.getById throws ForbiddenException / NotFoundException as needed.
    try {
      await this.orders.getById(userId, payment.orderId);
    } catch {
      // Translate any error from the order ownership check into a 403, so
      // we don't leak the existence of payments belonging to other users.
      throw new ForbiddenException();
    }
    return PaymentResponseDto.from(payment);
  }
}
