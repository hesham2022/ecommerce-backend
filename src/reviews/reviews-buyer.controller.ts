import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { Review } from './domain/review';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

@ApiTags('Buyer · Reviews')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: '', version: '1' })
export class ReviewsBuyerController {
  constructor(private readonly service: ReviewsService) {}

  @Post('orders/:id/suborders/:sid/items/:iid/review')
  @ApiOperation({
    summary:
      'Submit a review for a delivered order item. One review per order item; rating 1–5; up to 6 attached images.',
  })
  @ApiCreatedResponse({ type: Review })
  async submit(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Param('sid', ParseUUIDPipe) subOrderId: string,
    @Param('iid', ParseUUIDPipe) itemId: string,
    @Body() dto: CreateReviewDto,
  ): Promise<Review> {
    const userId = (req.user as { id: number }).id;
    return this.service.submitReview(userId, orderId, subOrderId, itemId, {
      rating: dto.rating,
      body: dto.body,
      mediaFileIds: dto.mediaFileIds,
    });
  }

  @Patch('me/reviews/:id')
  @ApiOperation({
    summary:
      'Edit your own review. Allowed within 14 days of creation; rating becomes immutable once the vendor has responded.',
  })
  @ApiOkResponse({ type: Review })
  async edit(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReviewDto,
  ): Promise<Review> {
    const userId = (req.user as { id: number }).id;
    return this.service.editOwnReview(userId, id, {
      rating: dto.rating,
      body: dto.body,
    });
  }

  @Delete('me/reviews/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Hide your own review (soft-delete). Blocked once the vendor has responded.',
  })
  @ApiOkResponse({ type: Review })
  async hide(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Review> {
    const userId = (req.user as { id: number }).id;
    return this.service.hideOwnReview(userId, id);
  }
}
