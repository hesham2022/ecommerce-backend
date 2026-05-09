import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OrderEvent } from '../../../../domain/order-event';
import {
  CreateOrderEventRow,
  ListEventsOptions,
  ListEventsResult,
  OrderEventAbstractRepository,
} from '../../order-event.abstract.repository';
import { OrderEventEntity } from '../entities/order-event.entity';
import { OrderEventMapper } from '../mappers/order-event.mapper';

@Injectable()
export class OrderEventRelationalRepository implements OrderEventAbstractRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(OrderEventEntity)
    private readonly repo: Repository<OrderEventEntity>,
  ) {}

  async append(
    row: CreateOrderEventRow,
    em?: EntityManager,
  ): Promise<OrderEvent> {
    const repo = em ? em.getRepository(OrderEventEntity) : this.repo;
    const entity = repo.create({
      id: row.id,
      subOrderId: row.subOrderId,
      eventType: row.eventType,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      actorUserId: row.actorUserId,
      payload: row.payload,
    });
    const saved = await repo.save(entity);
    return OrderEventMapper.toDomain(saved);
  }

  async listForSubOrder(opts: ListEventsOptions): Promise<ListEventsResult> {
    const offset = (opts.page - 1) * opts.limit;
    const [rows, total] = await this.repo
      .createQueryBuilder('e')
      .where('e.sub_order_id = :sid', { sid: opts.subOrderId })
      .orderBy('e.created_at', 'ASC')
      .addOrderBy('e.id', 'ASC')
      .skip(offset)
      .take(opts.limit)
      .getManyAndCount();

    return {
      data: rows.map(OrderEventMapper.toDomain),
      total,
    };
  }
}
