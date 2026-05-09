import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ProductsService } from '../products/products.service';
import { SubOrder } from './domain/sub-order';
import { UpdateSubOrderStatusDto } from './dto/update-suborder-status.dto';
import { FulfillmentService } from './fulfillment.service';

@ApiTags('Vendor · Orders')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'vendor/suborders', version: '1' })
export class VendorSubOrdersController {
  constructor(
    private readonly products: ProductsService,
    private readonly fulfillment: FulfillmentService,
  ) {}

  @Patch(':sid/status')
  @ApiOperation({
    summary:
      'Vendor-driven status change. Allowed targets: CONFIRMED, PACKED, SHIPPED, CANCELLED. tracking_number required for SHIPPED; cancellation_reason required for CANCELLED.',
  })
  @ApiOkResponse({ type: SubOrder })
  async updateStatus(
    @Req() req: Request,
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() dto: UpdateSubOrderStatusDto,
  ): Promise<SubOrder> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.products.getCallingActiveVendor(userId);
    return this.fulfillment.vendorUpdateStatus({
      vendorId: vendor.id,
      subOrderId: sid,
      actorUserId: userId,
      target: dto.status,
      trackingNumber: dto.trackingNumber ?? null,
      courierName: dto.courierName ?? null,
      cancellationReason: dto.cancellationReason ?? null,
    });
  }
}
