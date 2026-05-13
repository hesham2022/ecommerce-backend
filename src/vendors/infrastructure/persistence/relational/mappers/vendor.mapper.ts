import { Vendor } from '../../../../domain/vendor';
import { VendorEntity } from '../entities/vendor.entity';

export class VendorMapper {
  static toDomain(entity: VendorEntity): Vendor {
    const d = new Vendor();
    d.id = entity.id;
    d.userId = entity.userId;
    d.slug = entity.slug;
    d.nameTranslations = entity.nameTranslations;
    d.descriptionTranslations = entity.descriptionTranslations ?? {};
    d.logoFileId = entity.logoFileId;
    d.bannerFileId = entity.bannerFileId;
    d.status = entity.status;
    d.kycStatus = entity.kycStatus;
    d.defaultRegionId = entity.defaultRegionId;
    d.supportedRegionIds = entity.supportedRegionIds ?? [];
    d.returnWindowDays = entity.returnWindowDays;
    d.shipsFromCountry = entity.shipsFromCountry;
    d.commissionRate = entity.commissionRate;
    d.createdAt = entity.createdAt;
    d.updatedAt = entity.updatedAt;
    return d;
  }
}
