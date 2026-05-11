import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { VendorsService } from '../vendors/vendors.service';
import { KycDocumentType } from './domain/kyc-enums';
import { KycDocumentResponseDto } from './dto/kyc-document-response.dto';
import { KycStatusResponseDto } from './dto/kyc-status-response.dto';
import { UploadKycDocumentDto } from './dto/upload-kyc-document.dto';
import { KycService } from './kyc.service';

@ApiTags('Vendor · KYC')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'vendor/kyc', version: '1' })
export class VendorKycController {
  constructor(
    private readonly kyc: KycService,
    // Uses VendorsService.getCallingVendor (no status filter) instead of
    // ProductsService.getCallingActiveVendor — PENDING vendors must be able
    // to submit and inspect KYC before activation. Activation depends on
    // KYC being approved (see VendorsService.approve), so filtering on
    // ACTIVE here would create an unresolvable chicken-and-egg.
    private readonly vendors: VendorsService,
  ) {}

  @Post('documents')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: KycDocumentResponseDto })
  async upload(
    @Req() req: Request,
    @Body() dto: UploadKycDocumentDto,
  ): Promise<KycDocumentResponseDto> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.vendors.getCallingVendor(userId);
    const doc = await this.kyc.upload({
      vendorId: vendor.id,
      type: dto.type,
      fileId: dto.fileId,
      details: dto.details,
    });
    return KycDocumentResponseDto.from(doc);
  }

  @Get('documents')
  @ApiOkResponse({ type: KycDocumentResponseDto, isArray: true })
  async listMine(@Req() req: Request): Promise<KycDocumentResponseDto[]> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.vendors.getCallingVendor(userId);
    const docs = await this.kyc.listForVendor(vendor.id);
    return docs.map(KycDocumentResponseDto.from);
  }

  @Get('documents/history')
  @ApiOkResponse({ type: KycDocumentResponseDto, isArray: true })
  async history(
    @Req() req: Request,
    @Query('type') type?: KycDocumentType,
  ): Promise<KycDocumentResponseDto[]> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.vendors.getCallingVendor(userId);
    const docs = await this.kyc.listForVendor(vendor.id, {
      type,
      includeSuperseded: true,
    });
    return docs.map(KycDocumentResponseDto.from);
  }

  @Get('status')
  @ApiOkResponse({ type: KycStatusResponseDto })
  async status(@Req() req: Request): Promise<KycStatusResponseDto> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.vendors.getCallingVendor(userId);
    const summary = await this.kyc.getStatusSummary(vendor.id);
    const dto = new KycStatusResponseDto();
    dto.kycStatus = summary.kycStatus;
    dto.requiredTypes = summary.requiredTypes;
    dto.submittedTypes = summary.submittedTypes;
    dto.missingTypes = summary.missingTypes;
    dto.rejectedTypes = summary.rejectedTypes;
    dto.expiringSoon = summary.expiringSoon;
    dto.expired = summary.expired;
    return dto;
  }
}
