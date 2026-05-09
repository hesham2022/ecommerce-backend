import { VendorResponse } from '../../../../domain/vendor-response';
import { VendorResponseEntity } from '../entities/vendor-response.entity';

export class VendorResponseMapper {
  static toDomain(entity: VendorResponseEntity): VendorResponse {
    const d = new VendorResponse();
    d.id = entity.id;
    d.reviewId = entity.reviewId;
    d.body = entity.body;
    d.createdAt = entity.createdAt;
    d.updatedAt = entity.updatedAt;
    return d;
  }
}
