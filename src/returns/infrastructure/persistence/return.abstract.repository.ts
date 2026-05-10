import { Return } from '../../domain/return';
import { ReturnReason, ReturnStatus } from '../../domain/return-enums';

export interface CreateReturnInput {
  id: string;
  subOrderId: string;
  buyerId: number;
  vendorId: string;
  reason: ReturnReason;
  reasonNote: string | null;
  totalRefundMinor: string;
  items: Array<{
    id: string;
    orderItemId: string;
    quantity: number;
    refundAmountMinor: string;
  }>;
  attachmentFileIds: string[];
}

export interface ListForBuyerOptions {
  buyerId: number;
  subOrderId?: string;
  status?: ReturnStatus;
  page: number;
  limit: number;
}

export interface ListForVendorOptions {
  vendorId: string;
  subOrderId?: string;
  status?: ReturnStatus;
  page: number;
  limit: number;
}

export interface AdminListOptions {
  vendorId?: string;
  buyerId?: number;
  status?: ReturnStatus;
  page: number;
  limit: number;
}

export interface ListResult {
  data: Return[];
  total: number;
}

export interface CountOpenForOrderItemsInput {
  orderItemIds: string[];
}

export interface MarkApprovedInput {
  id: string;
  decidedAt: Date;
}

export interface MarkRejectedInput {
  id: string;
  rejectReason: string;
  rejectedAt: Date;
  fromStatus: ReturnStatus;
}

export interface MarkShippedBackInput {
  id: string;
  trackingNumber: string | null;
  shippedBackAt: Date;
}

export interface MarkReceivedInput {
  id: string;
  restock: boolean;
  receivedAt: Date;
  /**
   * Pairs of (variantId, qtyDelta) to apply to variant_stock when restock=true.
   * Empty when restock=false.
   */
  stockIncrements: Array<{ variantId: string; delta: number }>;
}

export interface MarkRefundedInput {
  id: string;
  refundedAt: Date;
}

export interface MarkClosedInput {
  id: string;
  closedAt: Date;
}

export abstract class ReturnAbstractRepository {
  abstract create(input: CreateReturnInput): Promise<Return>;
  abstract findById(id: string): Promise<Return | null>;
  abstract listForBuyer(opts: ListForBuyerOptions): Promise<ListResult>;
  abstract listForVendor(opts: ListForVendorOptions): Promise<ListResult>;
  abstract listForAdmin(opts: AdminListOptions): Promise<ListResult>;

  /**
   * Returns sum of `return_item.quantity` per `order_item_id`,
   * counting only return_requests whose status is NOT in (REJECTED).
   * Used to enforce the open-RMA + cumulative-quantity constraint at create-time.
   */
  abstract sumNonRejectedQuantitiesByOrderItem(
    input: CountOpenForOrderItemsInput,
  ): Promise<Map<string, number>>;

  /**
   * Like sumNonRejectedQuantitiesByOrderItem but only counts CLOSED returns.
   * Used to determine whether all items of a sub-order have been fully
   * returned and the sub-order should flip to RETURNED.
   */
  abstract sumClosedQuantitiesByOrderItem(
    input: CountOpenForOrderItemsInput,
  ): Promise<Map<string, number>>;

  abstract markApproved(input: MarkApprovedInput): Promise<Return>;
  abstract markRejected(input: MarkRejectedInput): Promise<Return>;
  abstract markShippedBack(input: MarkShippedBackInput): Promise<Return>;
  abstract markReceived(input: MarkReceivedInput): Promise<Return>;
  abstract markRefunded(input: MarkRefundedInput): Promise<Return>;
  abstract markClosed(input: MarkClosedInput): Promise<Return>;
}
