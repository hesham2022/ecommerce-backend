import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ProductsService } from '../products/products.service';
import { Review } from './domain/review';
import { VendorResponse } from './domain/vendor-response';
import { ReviewsService } from './reviews.service';
import { ListVendorReviewsQueryDto } from './dto/list-vendor-reviews-query.dto';
import { VendorResponseBodyDto } from './dto/vendor-response.dto';

@ApiTags('Vendor · Reviews')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'vendor/reviews', version: '1' })
export class ReviewsVendorController {
  constructor(
    private readonly service: ReviewsService,
    private readonly products: ProductsService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List reviews for products owned by the calling vendor. Optional ?status filter.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/Review' } },
        total: { type: 'number' },
      },
    },
  })
  async list(
    @Req() req: Request,
    @Query() query: ListVendorReviewsQueryDto,
  ): Promise<{ data: Review[]; total: number }> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.products.getCallingActiveVendor(userId);
    return this.service.listForVendor(vendor.id, {
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  @Post(':id/response')
  @ApiOperation({
    summary: "Post the vendor's one-shot response to a review.",
  })
  @ApiCreatedResponse({ type: VendorResponse })
  async respond(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) reviewId: string,
    @Body() dto: VendorResponseBodyDto,
  ): Promise<VendorResponse> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.products.getCallingActiveVendor(userId);
    return this.service.createVendorResponse(vendor.id, reviewId, dto.body);
  }

  @Patch(':id/response')
  @ApiOperation({ summary: "Edit the vendor's existing response." })
  @ApiOkResponse({ type: VendorResponse })
  async editResponse(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) reviewId: string,
    @Body() dto: VendorResponseBodyDto,
  ): Promise<VendorResponse> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.products.getCallingActiveVendor(userId);
    return this.service.updateVendorResponse(vendor.id, reviewId, dto.body);
  }
}
