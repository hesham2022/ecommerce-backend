import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OrderEventEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order-event.entity';
import { OrderEventType } from '../../../../../orders/domain/order-enums';
import { uuidv7Generate } from '../../../../../utils/uuid';
import { Return } from '../../../../domain/return';
import { ReturnStatus } from '../../../../domain/return-enums';
import {
  AdminListOptions,
  CountOpenForOrderItemsInput,
  CreateReturnInput,
  ListForBuyerOptions,
  ListForVendorOptions,
  ListResult,
  MarkApprovedInput,
  MarkClosedInput,
  MarkReceivedInput,
  MarkRefundedInput,
  MarkRejectedInput,
  MarkShippedBackInput,
  ReturnAbstractRepository,
} from '../../return.abstract.repository';
import { ReturnAttachmentEntity } from '../entities/return-attachment.entity';
import { ReturnItemEntity } from '../entities/return-item.entity';
import { ReturnRequestEntity } from '../entities/return-request.entity';
import { ReturnMapper } from '../mappers/return.mapper';

@Injectable()
export class ReturnRelationalRepository implements ReturnAbstractRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ReturnRequestEntity)
    private readonly repo: Repository<ReturnRequestEntity>,
  ) {}

  async create(input: CreateReturnInput): Promise<Return> {
    return this.dataSource.transaction(async (em) => {
      const requestRepo = em.getRepository(ReturnRequestEntity);
      const itemRepo = em.getRepository(ReturnItemEntity);
      const attachmentRepo = em.getRepository(ReturnAttachmentEntity);
      const eventRepo = em.getRepository(OrderEventEntity);

      const requestRow = requestRepo.create({
        id: input.id,
        subOrderId: input.subOrderId,
        buyerId: input.buyerId,
        vendorId: input.vendorId,
        status: ReturnStatus.REQUESTED,
        reason: input.reason,
        reasonNote: input.reasonNote,
        totalRefundMinor: input.totalRefundMinor,
        restocked: null,
        rejectReason: null,
        decidedAt: null,
        shippedBackAt: null,
        receivedAt: null,
        refundedAt: null,
        closedAt: null,
        rejectedAt: null,
        returnTrackingNumber: null,
      });
      await requestRepo.save(requestRow);

      const itemRows = input.items.map((i) =>
        itemRepo.create({
          id: i.id,
          returnRequestId: input.id,
          orderItemId: i.orderItemId,
          quantity: i.quantity,
          refundAmountMinor: i.refundAmountMinor,
        }),
      );
      if (itemRows.length > 0) {
        await itemRepo.save(itemRows);
      }

      const attachmentRows = input.attachmentFileIds.map((fileId) =>
        attachmentRepo.create({
          id: uuidv7Generate(),
          returnRequestId: input.id,
          fileId,
        }),
      );
      if (attachmentRows.length > 0) {
        await attachmentRepo.save(attachmentRows);
      }

      await eventRepo.save(
        eventRepo.create({
          id: uuidv7Generate(),
          subOrderId: input.subOrderId,
          eventType: OrderEventType.RETURN_REQUESTED,
          fromStatus: null,
          toStatus: ReturnStatus.REQUESTED,
          actorUserId: input.buyerId,
          payload: { returnRequestId: input.id, reason: input.reason },
        }),
      );

      return this.loadAndMap(em, input.id);
    });
  }

  async findById(id: string): Promise<Return | null> {
    const row = await this.repo.findOne({
      where: { id },
      relations: { items: true, attachments: true },
    });
    return row ? ReturnMapper.toDomain(row) : null;
  }

  async listForBuyer(opts: ListForBuyerOptions): Promise<ListResult> {
    const offset = (opts.page - 1) * opts.limit;
    const qb = this.repo
      .createQueryBuilder('rr')
      .leftJoinAndSelect('rr.items', 'items')
      .leftJoinAndSelect('rr.attachments', 'attachments')
      .where('rr.buyer_id = :buyerId', { buyerId: opts.buyerId });
    if (opts.subOrderId) {
      qb.andWhere('rr.sub_order_id = :subOrderId', {
        subOrderId: opts.subOrderId,
      });
    }
    if (opts.status) {
      qb.andWhere('rr.status = :status', { status: opts.status });
    }
    const [rows, total] = await qb
      .orderBy('rr.created_at', 'DESC')
      .skip(offset)
      .take(opts.limit)
      .getManyAndCount();
    return { data: rows.map(ReturnMapper.toDomain), total };
  }

  async listForVendor(opts: ListForVendorOptions): Promise<ListResult> {
    const offset = (opts.page - 1) * opts.limit;
    const qb = this.repo
      .createQueryBuilder('rr')
      .leftJoinAndSelect('rr.items', 'items')
      .leftJoinAndSelect('rr.attachments', 'attachments')
      .where('rr.vendor_id = :vendorId', { vendorId: opts.vendorId });
    if (opts.subOrderId) {
      qb.andWhere('rr.sub_order_id = :subOrderId', {
        subOrderId: opts.subOrderId,
      });
    }
    if (opts.status) {
      qb.andWhere('rr.status = :status', { status: opts.status });
    }
    const [rows, total] = await qb
      .orderBy('rr.created_at', 'DESC')
      .skip(offset)
      .take(opts.limit)
      .getManyAndCount();
    return { data: rows.map(ReturnMapper.toDomain), total };
  }

  async listForAdmin(opts: AdminListOptions): Promise<ListResult> {
    const offset = (opts.page - 1) * opts.limit;
    const qb = this.repo
      .createQueryBuilder('rr')
      .leftJoinAndSelect('rr.items', 'items')
      .leftJoinAndSelect('rr.attachments', 'attachments');
    if (opts.vendorId) {
      qb.andWhere('rr.vendor_id = :vendorId', { vendorId: opts.vendorId });
    }
    if (opts.buyerId !== undefined) {
      qb.andWhere('rr.buyer_id = :buyerId', { buyerId: opts.buyerId });
    }
    if (opts.status) {
      qb.andWhere('rr.status = :status', { status: opts.status });
    }
    const [rows, total] = await qb
      .orderBy('rr.created_at', 'DESC')
      .skip(offset)
      .take(opts.limit)
      .getManyAndCount();
    return { data: rows.map(ReturnMapper.toDomain), total };
  }

  async sumNonRejectedQuantitiesByOrderItem(
    input: CountOpenForOrderItemsInput,
  ): Promise<Map<string, number>> {
    if (input.orderItemIds.length === 0) return new Map();
    const rows = await this.dataSource
      .getRepository(ReturnItemEntity)
      .createQueryBuilder('ri')
      .innerJoin('ri.returnRequest', 'rr')
      .select('ri.order_item_id', 'orderItemId')
      .addSelect('COALESCE(SUM(ri.quantity), 0)', 'qty')
      .where('ri.order_item_id IN (:...ids)', { ids: input.orderItemIds })
      .andWhere('rr.status != :rejected', { rejected: ReturnStatus.REJECTED })
      .groupBy('ri.order_item_id')
      .getRawMany<{ orderItemId: string; qty: string }>();
    return new Map(rows.map((r) => [r.orderItemId, Number(r.qty)]));
  }

  async sumClosedQuantitiesByOrderItem(
    input: CountOpenForOrderItemsInput,
  ): Promise<Map<string, number>> {
    if (input.orderItemIds.length === 0) return new Map();
    const rows = await this.dataSource
      .getRepository(ReturnItemEntity)
      .createQueryBuilder('ri')
      .innerJoin('ri.returnRequest', 'rr')
      .select('ri.order_item_id', 'orderItemId')
      .addSelect('COALESCE(SUM(ri.quantity), 0)', 'qty')
      .where('ri.order_item_id IN (:...ids)', { ids: input.orderItemIds })
      .andWhere('rr.status = :closed', { closed: ReturnStatus.CLOSED })
      .groupBy('ri.order_item_id')
      .getRawMany<{ orderItemId: string; qty: string }>();
    return new Map(rows.map((r) => [r.orderItemId, Number(r.qty)]));
  }

  async markApproved(input: MarkApprovedInput): Promise<Return> {
    return this.dataSource.transaction(async (em) => {
      const requestRepo = em.getRepository(ReturnRequestEntity);
      const eventRepo = em.getRepository(OrderEventEntity);
      const row = await requestRepo.findOne({ where: { id: input.id } });
      if (!row) throw new NotFoundException(`Return ${input.id} not found`);
      row.status = ReturnStatus.APPROVED;
      row.decidedAt = input.decidedAt;
      await requestRepo.save(row);
      await eventRepo.save(
        eventRepo.create({
          id: uuidv7Generate(),
          subOrderId: row.subOrderId,
          eventType: OrderEventType.RETURN_APPROVED,
          fromStatus: ReturnStatus.REQUESTED,
          toStatus: ReturnStatus.APPROVED,
          actorUserId: null,
          payload: { returnRequestId: input.id },
        }),
      );
      return this.loadAndMap(em, input.id);
    });
  }

  async markRejected(input: MarkRejectedInput): Promise<Return> {
    return this.dataSource.transaction(async (em) => {
      const requestRepo = em.getRepository(ReturnRequestEntity);
      const eventRepo = em.getRepository(OrderEventEntity);
      const row = await requestRepo.findOne({ where: { id: input.id } });
      if (!row) throw new NotFoundException(`Return ${input.id} not found`);
      row.status = ReturnStatus.REJECTED;
      row.rejectReason = input.rejectReason;
      row.rejectedAt = input.rejectedAt;
      // decidedAt records the FIRST decision; only set if not already set.
      if (!row.decidedAt) row.decidedAt = input.rejectedAt;
      await requestRepo.save(row);
      await eventRepo.save(
        eventRepo.create({
          id: uuidv7Generate(),
          subOrderId: row.subOrderId,
          eventType: OrderEventType.RETURN_REJECTED,
          fromStatus: input.fromStatus,
          toStatus: ReturnStatus.REJECTED,
          actorUserId: null,
          payload: {
            returnRequestId: input.id,
            rejectReason: input.rejectReason,
          },
        }),
      );
      return this.loadAndMap(em, input.id);
    });
  }

  async markShippedBack(input: MarkShippedBackInput): Promise<Return> {
    return this.dataSource.transaction(async (em) => {
      const requestRepo = em.getRepository(ReturnRequestEntity);
      const eventRepo = em.getRepository(OrderEventEntity);
      const row = await requestRepo.findOne({ where: { id: input.id } });
      if (!row) throw new NotFoundException(`Return ${input.id} not found`);
      row.status = ReturnStatus.SHIPPED_BACK;
      row.shippedBackAt = input.shippedBackAt;
      row.returnTrackingNumber = input.trackingNumber;
      await requestRepo.save(row);
      await eventRepo.save(
        eventRepo.create({
          id: uuidv7Generate(),
          subOrderId: row.subOrderId,
          eventType: OrderEventType.RETURN_SHIPPED_BACK,
          fromStatus: ReturnStatus.APPROVED,
          toStatus: ReturnStatus.SHIPPED_BACK,
          actorUserId: row.buyerId,
          payload: {
            returnRequestId: input.id,
            trackingNumber: input.trackingNumber,
          },
        }),
      );
      return this.loadAndMap(em, input.id);
    });
  }

  async markReceived(input: MarkReceivedInput): Promise<Return> {
    return this.dataSource.transaction(async (em) => {
      const requestRepo = em.getRepository(ReturnRequestEntity);
      const eventRepo = em.getRepository(OrderEventEntity);
      const row = await requestRepo.findOne({ where: { id: input.id } });
      if (!row) throw new NotFoundException(`Return ${input.id} not found`);
      row.status = ReturnStatus.RECEIVED;
      row.receivedAt = input.receivedAt;
      row.restocked = input.restock;
      await requestRepo.save(row);

      // Cross-domain restock — performed inside the same transaction so the
      // RMA status flip and the stock increment are atomic. Uses raw SQL
      // increment to avoid a separate read-modify-write race.
      if (input.restock) {
        for (const inc of input.stockIncrements) {
          await em.query(
            `UPDATE "variant_stock" SET "quantity" = "quantity" + $1 WHERE "variant_id" = $2`,
            [inc.delta, inc.variantId],
          );
        }
      }

      await eventRepo.save(
        eventRepo.create({
          id: uuidv7Generate(),
          subOrderId: row.subOrderId,
          eventType: OrderEventType.RETURN_RECEIVED,
          fromStatus: ReturnStatus.SHIPPED_BACK,
          toStatus: ReturnStatus.RECEIVED,
          actorUserId: null,
          payload: { returnRequestId: input.id, restock: input.restock },
        }),
      );
      return this.loadAndMap(em, input.id);
    });
  }

  async markRefunded(input: MarkRefundedInput): Promise<Return> {
    return this.dataSource.transaction(async (em) => {
      const requestRepo = em.getRepository(ReturnRequestEntity);
      const eventRepo = em.getRepository(OrderEventEntity);
      const row = await requestRepo.findOne({ where: { id: input.id } });
      if (!row) throw new NotFoundException(`Return ${input.id} not found`);
      row.status = ReturnStatus.REFUNDED;
      row.refundedAt = input.refundedAt;
      await requestRepo.save(row);
      await eventRepo.save(
        eventRepo.create({
          id: uuidv7Generate(),
          subOrderId: row.subOrderId,
          eventType: OrderEventType.RETURN_REFUNDED,
          fromStatus: ReturnStatus.RECEIVED,
          toStatus: ReturnStatus.REFUNDED,
          actorUserId: null,
          payload: { returnRequestId: input.id },
        }),
      );
      return this.loadAndMap(em, input.id);
    });
  }

  async markClosed(input: MarkClosedInput): Promise<Return> {
    return this.dataSource.transaction(async (em) => {
      const requestRepo = em.getRepository(ReturnRequestEntity);
      const eventRepo = em.getRepository(OrderEventEntity);
      const row = await requestRepo.findOne({ where: { id: input.id } });
      if (!row) throw new NotFoundException(`Return ${input.id} not found`);
      row.status = ReturnStatus.CLOSED;
      row.closedAt = input.closedAt;
      await requestRepo.save(row);
      await eventRepo.save(
        eventRepo.create({
          id: uuidv7Generate(),
          subOrderId: row.subOrderId,
          eventType: OrderEventType.RETURN_CLOSED,
          fromStatus: ReturnStatus.REFUNDED,
          toStatus: ReturnStatus.CLOSED,
          actorUserId: null,
          payload: { returnRequestId: input.id },
        }),
      );
      return this.loadAndMap(em, input.id);
    });
  }

  private async loadAndMap(em: EntityManager, id: string): Promise<Return> {
    const row = await em.getRepository(ReturnRequestEntity).findOne({
      where: { id },
      relations: { items: true, attachments: true },
    });
    if (!row) throw new NotFoundException(`Return ${id} not found after write`);
    return ReturnMapper.toDomain(row);
  }
}
