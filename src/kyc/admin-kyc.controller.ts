import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminAuditLogService } from '../admin-audit-log/admin-audit-log.service';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { RolesGuard } from '../roles/roles.guard';
import { KycDocumentStatus } from './domain/kyc-enums';
import { KycDocumentResponseDto } from './dto/kyc-document-response.dto';
import { ReviewKycDocumentDto } from './dto/review-kyc-document.dto';
import { KycService } from './kyc.service';

@ApiTags('Admin · KYC')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(RoleEnum.admin)
@Controller({ path: 'admin/kyc', version: '1' })
export class AdminKycController {
  constructor(
    private readonly kyc: KycService,
    private readonly audit: AdminAuditLogService,
  ) {}

  @Get('queue')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array' },
        total: { type: 'number' },
      },
    },
  })
  async queue(
    @Query('status') status?: KycDocumentStatus,
    @Query('vendorId') vendorId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ): Promise<{ data: KycDocumentResponseDto[]; total: number }> {
    const result = await this.kyc.listForAdmin({
      status,
      vendorId,
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(100, Math.max(1, Number(limit) || 20)),
      currentOnly: true,
    });
    return {
      data: result.data.map(KycDocumentResponseDto.from),
      total: result.total,
    };
  }

  @Get('vendors/:vendorId')
  @ApiOkResponse({ type: KycDocumentResponseDto, isArray: true })
  async forVendor(
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
  ): Promise<KycDocumentResponseDto[]> {
    const docs = await this.kyc.listForVendor(vendorId);
    return docs.map(KycDocumentResponseDto.from);
  }

  @Patch('documents/:id')
  @ApiOkResponse({ type: KycDocumentResponseDto })
  async review(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewKycDocumentDto,
  ): Promise<KycDocumentResponseDto> {
    const adminUserId = (req.user as { id: number }).id;

    // Load the doc so we know its vendorId for both the service call (which
    // re-validates ownership) and the audit-log payload.
    const existing = await this.kyc.findById(id);
    if (!existing) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    const result = await this.kyc.review({
      documentId: id,
      vendorId: existing.vendorId,
      status: dto.status,
      rejectReason: dto.rejectReason,
      reviewedByUserId: adminUserId,
    });

    await this.audit.record({
      adminUserId,
      action:
        dto.status === KycDocumentStatus.APPROVED
          ? 'KYC_DOC_APPROVED'
          : 'KYC_DOC_REJECTED',
      targetType: 'kyc_document',
      targetId: id,
      payload: {
        vendorId: existing.vendorId,
        type: existing.type,
        ...(dto.rejectReason ? { rejectReason: dto.rejectReason } : {}),
      },
    });

    return KycDocumentResponseDto.from(result);
  }
}
