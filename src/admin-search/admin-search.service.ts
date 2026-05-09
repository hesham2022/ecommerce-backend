import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VendorEntity } from '../vendors/infrastructure/persistence/relational/entities/vendor.entity';
import { ProductEntity } from '../products/infrastructure/persistence/relational/entities/product.entity';
import { OrderEntity } from '../orders/infrastructure/persistence/relational/entities/order.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { AdminSearchType } from './dto/admin-search-query.dto';

export interface AdminSearchResult {
  vendors: Array<{
    id: string;
    slug: string;
    nameTranslations: Record<string, string>;
    status: string;
  }>;
  products: Array<{
    id: string;
    slug: string;
    nameTranslations: Record<string, string>;
    status: string;
    vendorId: string;
  }>;
  orders: Array<{
    id: string;
    publicCode: string;
    buyerId: number;
    totalMinor: string;
    currencyCode: string;
  }>;
  users: Array<{
    id: number;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  }>;
}

@Injectable()
export class AdminSearchService {
  constructor(
    @InjectRepository(VendorEntity)
    private readonly vendors: Repository<VendorEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  async search(
    rawQ: string,
    type: AdminSearchType | undefined,
    limit: number,
  ): Promise<AdminSearchResult> {
    const q = rawQ.trim();
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const out: AdminSearchResult = {
      vendors: [],
      products: [],
      orders: [],
      users: [],
    };

    const include = (t: AdminSearchType) => !type || type === t;

    if (include(AdminSearchType.vendor)) {
      const rows = await this.vendors
        .createQueryBuilder('v')
        // jsonb_path_query_first is overkill — searching across translation values
        // by rendering the jsonb to text + ILIKE is fast enough for v1.
        .where('(v.name_translations::text ILIKE :p OR v.slug ILIKE :p)', {
          p: pattern,
        })
        .orderBy('v.created_at', 'DESC')
        .take(limit)
        .getMany();
      out.vendors = rows.map((v) => ({
        id: v.id,
        slug: v.slug,
        nameTranslations: v.nameTranslations ?? {},
        status: v.status,
      }));
    }

    if (include(AdminSearchType.product)) {
      const rows = await this.products
        .createQueryBuilder('p')
        .where('(p.name_translations::text ILIKE :p OR p.slug ILIKE :p)', {
          p: pattern,
        })
        .orderBy('p.created_at', 'DESC')
        .take(limit)
        .getMany();
      out.products = rows.map((p) => ({
        id: p.id,
        slug: p.slug,
        nameTranslations: p.nameTranslations ?? {},
        status: p.status,
        vendorId: p.vendorId,
      }));
    }

    if (include(AdminSearchType.order)) {
      const rows = await this.orders
        .createQueryBuilder('o')
        .where('o.public_code ILIKE :p', { p: pattern })
        .orderBy('o.placed_at', 'DESC')
        .take(limit)
        .getMany();
      out.orders = rows.map((o) => ({
        id: o.id,
        publicCode: o.publicCode,
        buyerId: o.buyerId,
        totalMinor: String(o.totalMinor),
        currencyCode: o.currencyCode,
      }));
    }

    if (include(AdminSearchType.user)) {
      const rows = await this.users
        .createQueryBuilder('u')
        .where(
          '(u.email ILIKE :p OR u."firstName" ILIKE :p OR u."lastName" ILIKE :p)',
          { p: pattern },
        )
        .orderBy('u.id', 'DESC')
        .take(limit)
        .getMany();
      out.users = rows.map((u) => ({
        id: u.id,
        email: u.email ?? null,
        firstName: u.firstName ?? null,
        lastName: u.lastName ?? null,
      }));
    }

    return out;
  }
}
