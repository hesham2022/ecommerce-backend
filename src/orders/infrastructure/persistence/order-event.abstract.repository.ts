import { EntityManager } from 'typeorm';
import { OrderEvent } from '../../domain/order-event';
import { OrderEventType } from '../../domain/order-enums';

export interface CreateOrderEventRow {
  id: string;
  subOrderId: string;
  eventType: OrderEventType;
  fromStatus: string | null;
  toStatus: string | null;
  actorUserId: number | null;
  payload: Record<string, unknown> | null;
}

export interface ListEventsOptions {
  subOrderId: string;
  page: number;
  limit: number;
}

export interface ListEventsResult {
  data: OrderEvent[];
  total: number;
}

export abstract class OrderEventAbstractRepository {
  /**
   * Append one event. Pass an EntityManager to participate in an outer
   * transaction; otherwise the repository writes through its default conn.
   */
  abstract append(
    row: CreateOrderEventRow,
    em?: EntityManager,
  ): Promise<OrderEvent>;

  abstract listForSubOrder(opts: ListEventsOptions): Promise<ListEventsResult>;
}
