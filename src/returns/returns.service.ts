import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { uuidv7Generate } from '../utils/uuid';
import { OrderAbstractRepository } from '../orders/infrastructure/persistence/order.abstract.repository';
import { Order } from '../orders/domain/order';
import { SubOrderFulfillmentStatus } from '../orders/domain/order-enums';
import { FilesService } from '../files/files.service';
import { VendorsService } from '../vendors/vendors.service';
import { Return } from './domain/return';
import { ReturnReason, ReturnStatus } from './domain/return-enums';
import { ReturnAbstractRepository } from './infrastructure/persistence/return.abstract.repository';
import {
  assertBuyerTransition,
  assertVendorTransition,
} from './return-state-machine';

const MAX_ATTACHMENTS = 5;

export interface CreateReturnServiceInput {
  buyerId: number;
  orderId: string;
  subOrderId: string;
  items: Array<{ orderItemId: string; quantity: number }>;
  reason: ReturnReason;
  reasonNote?: string;
  fileIds?: string[];
}

export interface ConfirmShippedBackInput {
  buyerId: number;
  returnId: string;
  trackingNumber?: string;
}

export interface VendorTransitionInput {
  vendorId: string;
  returnId: string;
  targetStatus: ReturnStatus;
  rejectReason?: string;
  restock?: boolean;
}

@Injectable()
export class ReturnsService {
  constructor(
    private readonly returns: ReturnAbstractRepository,
    private readonly orders: OrderAbstractRepository,
    private readonly files: FilesService,
    private readonly vendors: VendorsService,
  ) {}

  async create(input: CreateReturnServiceInput): Promise<Return> {
    if (input.reason === ReturnReason.OTHER && !input.reasonNote?.trim()) {
      throw new UnprocessableEntityException(
        'reasonNote is required when reason is OTHER',
      );
    }
    const fileIds = input.fileIds ?? [];
    if (fileIds.length > MAX_ATTACHMENTS) {
      throw new UnprocessableEntityException(
        `At most ${MAX_ATTACHMENTS} attachments allowed`,
      );
    }
    if (fileIds.length > 0) {
      const files = await this.files.findByIds(fileIds);
      if (files.length !== fileIds.length) {
        throw new UnprocessableEntityException(
          'One or more file ids could not be found',
        );
      }
    }

    const order = await this.orders.findHydratedById(input.orderId);
    if (!order || order.buyerId !== input.buyerId) {
      throw new NotFoundException('Order not found');
    }
    const subOrder = order.subOrders?.find((s) => s.id === input.subOrderId);
    if (!subOrder) {
      throw new NotFoundException('Sub-order not found');
    }
    if (subOrder.fulfillmentStatus !== SubOrderFulfillmentStatus.DELIVERED) {
      throw new UnprocessableEntityException(
        'Sub-order must be DELIVERED to open a return',
      );
    }
    if (!subOrder.deliveredAt) {
      throw new UnprocessableEntityException(
        'Sub-order is missing a deliveredAt timestamp',
      );
    }
    const vendor = await this.vendors.getById(subOrder.vendorId);
    const windowDays = vendor.returnWindowDays ?? 0;
    const windowEndMs =
      subOrder.deliveredAt.getTime() + windowDays * 24 * 60 * 60 * 1000;
    if (Date.now() > windowEndMs) {
      throw new UnprocessableEntityException(
        `Return window of ${windowDays} day(s) has expired`,
      );
    }

    // Validate per-item quantities (≤ ordered) and cumulative (existing
    // non-rejected returns + this request ≤ ordered).
    const orderedByItemId = new Map<
      string,
      { qty: number; variantId: string; unitPriceMinor: string }
    >();
    for (const item of subOrder.items ?? []) {
      orderedByItemId.set(item.id, {
        qty: item.quantity,
        variantId: item.variantId,
        unitPriceMinor: item.unitPriceSnapshot,
      });
    }
    for (const ri of input.items) {
      const ordered = orderedByItemId.get(ri.orderItemId);
      if (!ordered) {
        throw new UnprocessableEntityException(
          `orderItemId ${ri.orderItemId} not in sub-order ${input.subOrderId}`,
        );
      }
      if (ri.quantity > ordered.qty) {
        throw new UnprocessableEntityException(
          `quantity ${ri.quantity} exceeds ordered ${ordered.qty} for item ${ri.orderItemId}`,
        );
      }
    }

    const orderItemIds = input.items.map((i) => i.orderItemId);
    const existingByItem =
      await this.returns.sumNonRejectedQuantitiesByOrderItem({
        orderItemIds,
      });
    for (const ri of input.items) {
      const ordered = orderedByItemId.get(ri.orderItemId)!;
      const existing = existingByItem.get(ri.orderItemId) ?? 0;
      if (existing + ri.quantity > ordered.qty) {
        throw new UnprocessableEntityException(
          `cumulative return quantity (${existing + ri.quantity}) exceeds ordered (${ordered.qty}) for item ${ri.orderItemId}`,
        );
      }
    }

    // Compute refund amounts
    const itemsWithIds = input.items.map((ri) => {
      const ordered = orderedByItemId.get(ri.orderItemId)!;
      const refundAmountMinor = (
        BigInt(ordered.unitPriceMinor) * BigInt(ri.quantity)
      ).toString();
      return {
        id: uuidv7Generate(),
        orderItemId: ri.orderItemId,
        quantity: ri.quantity,
        refundAmountMinor,
      };
    });
    const totalRefundMinor = itemsWithIds
      .reduce((acc, i) => acc + BigInt(i.refundAmountMinor), 0n)
      .toString();

    return this.returns.create({
      id: uuidv7Generate(),
      subOrderId: input.subOrderId,
      buyerId: input.buyerId,
      vendorId: subOrder.vendorId,
      reason: input.reason,
      reasonNote: input.reasonNote?.trim() ?? null,
      totalRefundMinor,
      items: itemsWithIds,
      attachmentFileIds: fileIds,
    });
  }

  async getByIdForBuyer(buyerId: number, returnId: string): Promise<Return> {
    const r = await this.returns.findById(returnId);
    if (!r || r.buyerId !== buyerId) {
      throw new NotFoundException('Return not found');
    }
    return r;
  }

  async getByIdForVendor(vendorId: string, returnId: string): Promise<Return> {
    const r = await this.returns.findById(returnId);
    if (!r || r.vendorId !== vendorId) {
      throw new NotFoundException('Return not found');
    }
    return r;
  }

  async getByIdForAdmin(returnId: string): Promise<Return> {
    const r = await this.returns.findById(returnId);
    if (!r) throw new NotFoundException('Return not found');
    return r;
  }

  async confirmShippedBack(input: ConfirmShippedBackInput): Promise<Return> {
    const existing = await this.getByIdForBuyer(input.buyerId, input.returnId);
    assertBuyerTransition(existing.status, ReturnStatus.SHIPPED_BACK);
    return this.returns.markShippedBack({
      id: input.returnId,
      trackingNumber: input.trackingNumber?.trim() ?? null,
      shippedBackAt: new Date(),
    });
  }

  async vendorTransition(input: VendorTransitionInput): Promise<Return> {
    const existing = await this.getByIdForVendor(
      input.vendorId,
      input.returnId,
    );
    assertVendorTransition(existing.status, input.targetStatus);

    const now = new Date();
    switch (input.targetStatus) {
      case ReturnStatus.APPROVED:
        return this.returns.markApproved({
          id: input.returnId,
          decidedAt: now,
        });

      case ReturnStatus.REJECTED:
        if (!input.rejectReason?.trim()) {
          throw new UnprocessableEntityException(
            'rejectReason is required when rejecting a return',
          );
        }
        return this.returns.markRejected({
          id: input.returnId,
          rejectReason: input.rejectReason.trim(),
          rejectedAt: now,
          fromStatus: existing.status,
        });

      case ReturnStatus.RECEIVED: {
        if (input.restock === undefined) {
          throw new UnprocessableEntityException(
            'restock is required when transitioning to RECEIVED',
          );
        }
        const stockIncrements = input.restock
          ? await this.computeStockIncrements(existing)
          : [];
        return this.returns.markReceived({
          id: input.returnId,
          restock: input.restock,
          receivedAt: now,
          stockIncrements,
        });
      }

      case ReturnStatus.REFUNDED:
        return this.returns.markRefunded({
          id: input.returnId,
          refundedAt: now,
        });

      case ReturnStatus.CLOSED: {
        const closed = await this.returns.markClosed({
          id: input.returnId,
          closedAt: now,
        });
        await this.tryFlipSubOrderToReturned(closed.subOrderId);
        return closed;
      }

      default:
        throw new UnprocessableEntityException(
          `Unsupported transition target: ${input.targetStatus}`,
        );
    }
  }

  /**
   * Compute (variantId, delta) pairs for the return's items by joining each
   * return_item's order_item_id back to the parent sub-order's items
   * (loaded via the orders repo). Empty if items can't be reconciled.
   */
  private async computeStockIncrements(
    r: Return,
  ): Promise<Array<{ variantId: string; delta: number }>> {
    const order = await this.findOrderForSubOrder(r.subOrderId);
    if (!order) return [];
    const subOrder = order.subOrders?.find((s) => s.id === r.subOrderId);
    if (!subOrder) return [];
    const variantById = new Map<string, string>();
    for (const oi of subOrder.items ?? []) variantById.set(oi.id, oi.variantId);
    return r.items
      .map((ri) => {
        const variantId = variantById.get(ri.orderItemId);
        return variantId ? { variantId, delta: ri.quantity } : null;
      })
      .filter((x): x is { variantId: string; delta: number } => x !== null);
  }

  /**
   * Loads the parent order for a sub-order. Stubbed in Task 8 — returns null
   * so `computeStockIncrements` falls back to an empty list. Task 9 wires this
   * up to a new `OrderAbstractRepository.findOrderIdForSubOrder` helper and
   * the existing `findHydratedById` path.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async findOrderForSubOrder(
    subOrderId: string,
  ): Promise<Order | null> {
    void subOrderId;
    return null;
  }

  /**
   * Attempts to flip the parent sub-order to RETURNED once a return is
   * CLOSED. Stubbed in Task 8 — Task 9 implements the auto-flip via the
   * orders repo.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async tryFlipSubOrderToReturned(subOrderId: string): Promise<void> {
    void subOrderId;
  }
}
