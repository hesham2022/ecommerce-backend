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
import { InjectRepository } from '@nestjs/typeorm';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { Roles } from '../roles/roles.decorator';
import { RolesGuard } from '../roles/roles.guard';
import { RoleEnum } from '../roles/roles.enum';
import { uuidv7Generate } from '../utils/uuid';
import { Review } from './domain/review';
import { ReviewsService } from './reviews.service';
import { AdminUpdateReviewDto } from './dto/admin-update-review.dto';
import { AdminAuditLogEntity } from './infrastructure/persistence/relational/entities/admin-audit-log.entity';
import { SubOrderFulfillmentStatus } from '../orders/domain/order-enums';

@ApiTags('Admin · Reviews')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(RoleEnum.admin)
@Controller({ path: 'admin', version: '1' })
export class ReviewsAdminController {
  constructor(
    private readonly service: ReviewsService,
    @InjectRepository(AdminAuditLogEntity)
    private readonly auditRepo: Repository<AdminAuditLogEntity>,
  ) {}

  @Patch('reviews/:id')
  @ApiOperation({
    summary:
      'Set a review status (PUBLISHED | HIDDEN | REPORTED). Append-only audit log entry written.',
  })
  @ApiOkResponse({ type: Review })
  async moderate(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateReviewDto,
  ): Promise<Review> {
    const adminUserId = (req.user as { id: number }).id;
    const before = await this.service.setStatus(id, dto.status);
    await this.auditRepo.save(
      this.auditRepo.create({
        id: uuidv7Generate(),
        adminUserId,
        action: 'review.status.set',
        targetType: 'review',
        targetId: id,
        payload: { status: dto.status },
      }),
    );
    return before;
  }

  /**
   * Admin override to mark a SubOrder fulfillment status. The buyer-/vendor-
   * facing transitions are owned by the fulfillment slice (phase 5); this
   * is the back-office switch reviewers' QA needs to seed DELIVERED state.
   */
  @Patch('sub-orders/:id/fulfillment-status')
  @ApiOperation({
    summary:
      'Admin-only override of a SubOrder fulfillment status (back-office tool).',
  })
  async setSubOrderStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { status: SubOrderFulfillmentStatus },
  ) {
    return this.service.adminSetSubOrderFulfillmentStatus(id, dto.status);
  }
}
