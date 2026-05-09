import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Review } from './domain/review';
import { ReviewsService } from './reviews.service';
import { ListPublicReviewsQueryDto } from './dto/list-public-reviews-query.dto';

@ApiTags('Reviews')
@Controller({
  path: 'products/:vendorSlug/:productSlug/reviews',
  version: '1',
})
export class ReviewsPublicController {
  constructor(private readonly service: ReviewsService) {}

  @Get()
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/Review' } },
        nextCursor: { type: 'string', nullable: true },
      },
    },
  })
  async list(
    @Param('vendorSlug') vendorSlug: string,
    @Param('productSlug') productSlug: string,
    @Query() query: ListPublicReviewsQueryDto,
  ): Promise<{ data: Review[]; nextCursor: string | null }> {
    return this.service.listPublicForProduct(
      vendorSlug,
      productSlug,
      query.cursor,
      query.limit ?? 20,
    );
  }

  @Get('summary')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        count: { type: 'number' },
        average: { type: 'number' },
        distribution: {
          type: 'object',
          properties: {
            '1': { type: 'number' },
            '2': { type: 'number' },
            '3': { type: 'number' },
            '4': { type: 'number' },
            '5': { type: 'number' },
          },
        },
      },
    },
  })
  async summary(
    @Param('vendorSlug') vendorSlug: string,
    @Param('productSlug') productSlug: string,
  ) {
    return this.service.summaryForProduct(vendorSlug, productSlug);
  }
}
