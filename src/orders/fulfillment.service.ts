import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { uuidv7Generate } from '../utils/uuid';
import {
  OrderEventType,
  OrderPaymentStatus,
  SubOrderFulfillmentStatus,
} from './domain/order-enums';
import { OrderEvent } from './domain/order-event';
import { SubOrder } from './domain/sub-order';
import { OrderEventAbstractRepository } from './infrastructure/persistence/order-event.abstract.repository';
import { OrderEntity } from './infrastructure/persistence/relational/entities/order.entity';
import { OrderEventEntity } from './infrastructure/persistence/relational/entities/order-event.entity';
import { SubOrderEntity } from './infrastructure/persistence/relational/entities/sub-order.entity';
import { OrderEventMapper } from './infrastructure/persistence/relational/mappers/order-event.mapper';
import { SubOrderMapper } from './infrastructure/persistence/relational/mappers/sub-order.mapper';
import {
  assertBuyerCanConfirmDelivery,
  assertVendorTransition,
  VendorTargetStatus,
} from './sub-order-state-machine';

export interface VendorUpdateStatusInput {
  vendorId: string;
  subOrderId: string;
  actorUserId: number;
  target: VendorTargetStatus;
  trackingNumber?: string | null;
  courierName?: string | null;
  cancellationReason?: string | null;
}

export interface BuyerConfirmDeliveryInput {
  buyerId: number;
  orderId: string;
  subOrderId: string;
}

export interface ListSubOrderEventsInput {
  userId: number;
  vendorId: string | null; // null if user has no active vendor
  orderId: string;
  subOrderId: string;
  page: number;
  limit: number;
}

@Injectable()
export class FulfillmentService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly events: OrderEventAbstractRepository,
  ) {}

  /**
   * Vendor-driven status change. Transactional: locks the SubOrder row,
   * validates the transition, applies side-effects (timestamps), and
   * appends an OrderEvent in the same TX.
   */
  async vendorUpdateStatus(input: VendorUpdateStatusInput): Promise<SubOrder> {
    return this.dataSource.transaction(async (em) => {
      const subRepo = em.getRepository(SubOrderEntity);

      // SELECT … FOR UPDATE so concurrent PATCH/confirm-delivery can't race.
      const sub = await subRepo
        .createQueryBuilder('so')
        .setLock('pessimistic_write')
        .where('so.id = :id', { id: input.subOrderId })
        .getOne();

      // 404 (not 403) when not vendor's own — don't leak existence.
      if (!sub) throw new NotFoundException('SubOrder not found');
      if (sub.vendorId !== input.vendorId) {
        throw new NotFoundException('SubOrder not found');
      }

      const from = sub.fulfillmentStatus;
      assertVendorTransition(from, input.target);

      // Per-target side-effects.
      const now = new Date();
      const payload: Record<string, unknown> = {};

      if (input.target === SubOrderFulfillmentStatus.PACKED) {
        sub.packedAt = now;
      } else if (input.target === SubOrderFulfillmentStatus.SHIPPED) {
        const trackingNumber = (input.trackingNumber ?? '').trim();
        if (!trackingNumber) {
          throw new UnprocessableEntityException(
            'tracking_number is required when transitioning to SHIPPED',
          );
        }
        sub.shippedAt = now;
        sub.trackingNumber = trackingNumber;
        if (input.courierName != null) {
          sub.courierName = input.courierName.trim() || null;
        }
        payload.trackingNumber = trackingNumber;
        if (sub.courierName) payload.courierName = sub.courierName;
      } else if (input.target === SubOrderFulfillmentStatus.CANCELLED) {
        const reason = (input.cancellationReason ?? '').trim();
        if (!reason) {
          throw new UnprocessableEntityException(
            'cancellation_reason is required when CANCELLING',
          );
        }
        // State machine already rejects CANCELLED from SHIPPED/DELIVERED,
        // but be explicit so the caller gets a clear message.
        if (
          from === SubOrderFulfillmentStatus.SHIPPED ||
          from === SubOrderFulfillmentStatus.DELIVERED
        ) {
          throw new UnprocessableEntityException(
            `Cannot cancel a sub-order that is already ${from}`,
          );
        }
        payload.cancellationReason = reason;
      }

      sub.fulfillmentStatus = input.target;
      const saved = await subRepo.save(sub);

      await this.events.append(
        {
          id: uuidv7Generate(),
          subOrderId: saved.id,
          eventType: OrderEventType.STATUS_CHANGED,
          fromStatus: from,
          toStatus: input.target,
          actorUserId: input.actorUserId,
          payload: Object.keys(payload).length > 0 ? payload : null,
        },
        em,
      );

      return SubOrderMapper.toDomain(saved);
    });
  }

  /**
   * Buyer-driven confirmation. Locks the SubOrder + parent Order row,
   * flips the SubOrder to DELIVERED, then recomputes Order.payment_status
   * for the COD case (CONFIRMED only when every SubOrder is DELIVERED;
   * PARTIAL once at least one is delivered but some are still in flight).
   */
  async buyerConfirmDelivery(
    input: BuyerConfirmDeliveryInput,
  ): Promise<SubOrder> {
    return this.dataSource.transaction(async (em) => {
      const orderRepo = em.getRepository(OrderEntity);
      const subRepo = em.getRepository(SubOrderEntity);

      const order = await orderRepo
        .createQueryBuilder('o')
        .setLock('pessimistic_write')
        .where('o.id = :id', { id: input.orderId })
        .getOne();

      if (!order) throw new NotFoundException('Order not found');
      if (order.buyerId !== input.buyerId) {
        throw new ForbiddenException('You do not own this order');
      }

      const sub = await subRepo
        .createQueryBuilder('so')
        .setLock('pessimistic_write')
        .where('so.id = :id', { id: input.subOrderId })
        .getOne();

      if (!sub || sub.orderId !== order.id) {
        throw new NotFoundException('SubOrder not found');
      }

      assertBuyerCanConfirmDelivery(sub.fulfillmentStatus);

      const fromStatus = sub.fulfillmentStatus;
      const now = new Date();
      sub.fulfillmentStatus = SubOrderFulfillmentStatus.DELIVERED;
      sub.deliveredAt = now;
      const savedSub = await subRepo.save(sub);

      // Both DELIVERED_BY_BUYER and PAYMENT_COLLECTED rows get appended.
      await this.events.append(
        {
          id: uuidv7Generate(),
          subOrderId: savedSub.id,
          eventType: OrderEventType.STATUS_CHANGED,
          fromStatus,
          toStatus: SubOrderFulfillmentStatus.DELIVERED,
          actorUserId: input.buyerId,
          payload: null,
        },
        em,
      );
      await this.events.append(
        {
          id: uuidv7Generate(),
          subOrderId: savedSub.id,
          eventType: OrderEventType.DELIVERED_BY_BUYER,
          fromStatus: null,
          toStatus: null,
          actorUserId: input.buyerId,
          payload: null,
        },
        em,
      );
      await this.events.append(
        {
          id: uuidv7Generate(),
          subOrderId: savedSub.id,
          eventType: OrderEventType.PAYMENT_COLLECTED,
          fromStatus: null,
          toStatus: null,
          actorUserId: input.buyerId,
          payload: null,
        },
        em,
      );

      // Recompute parent Order.payment_status. Re-read the sibling rows
      // inside the same TX so we see the just-saved sub.
      const siblings = await subRepo
        .createQueryBuilder('so')
        .where('so.order_id = :oid', { oid: order.id })
        .getMany();

      // "COLLECTED-eligible" for COD = SubOrder is DELIVERED.
      // CANCELLED rows are excluded from the count entirely (no money owed).
      const live = siblings.filter(
        (s) => s.fulfillmentStatus !== SubOrderFulfillmentStatus.CANCELLED,
      );
      const allDelivered =
        live.length > 0 &&
        live.every(
          (s) => s.fulfillmentStatus === SubOrderFulfillmentStatus.DELIVERED,
        );
      const someDelivered = live.some(
        (s) => s.fulfillmentStatus === SubOrderFulfillmentStatus.DELIVERED,
      );

      let nextPayment: OrderPaymentStatus = order.paymentStatus;
      if (allDelivered) {
        nextPayment = OrderPaymentStatus.COLLECTED;
      } else if (someDelivered) {
        nextPayment = OrderPaymentStatus.PARTIAL;
      } else {
        nextPayment = OrderPaymentStatus.PENDING;
      }
      if (nextPayment !== order.paymentStatus) {
        order.paymentStatus = nextPayment;
        await orderRepo.save(order);
      }

      return SubOrderMapper.toDomain(savedSub);
    });
  }

  /**
   * Timeline read. Either the order's buyer or the SubOrder's owning
   * vendor can read it; everyone else gets 404.
   */
  async listEvents(
    input: ListSubOrderEventsInput,
  ): Promise<{ data: OrderEvent[]; total: number }> {
    const subRepo = this.dataSource.getRepository(SubOrderEntity);
    const orderRepo = this.dataSource.getRepository(OrderEntity);

    const sub = await subRepo
      .createQueryBuilder('so')
      .where('so.id = :id', { id: input.subOrderId })
      .andWhere('so.order_id = :oid', { oid: input.orderId })
      .getOne();
    if (!sub) throw new NotFoundException('SubOrder not found');

    const order = await orderRepo.findOne({ where: { id: input.orderId } });
    if (!order) throw new NotFoundException('Order not found');

    const isBuyer = order.buyerId === input.userId;
    const isOwningVendor =
      input.vendorId != null && sub.vendorId === input.vendorId;
    if (!isBuyer && !isOwningVendor) {
      throw new NotFoundException('SubOrder not found');
    }

    return this.events.listForSubOrder({
      subOrderId: sub.id,
      page: input.page,
      limit: input.limit,
    });
  }
}

// Re-exported helpers for tests / consumers that mock this module.
export { OrderEventMapper, OrderEventEntity };
