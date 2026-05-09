import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { PaymentEvent } from '../../../../domain/payment-event';
import {
  PaymentEventAbstractRepository,
  RecordPaymentEventInput,
} from '../../payment-event.abstract.repository';
import { PaymentEventEntity } from '../entities/payment-event.entity';
import { PaymentEventMapper } from '../mappers/payment-event.mapper';

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class PaymentEventRelationalRepository implements PaymentEventAbstractRepository {
  constructor(
    @InjectRepository(PaymentEventEntity)
    private readonly repo: Repository<PaymentEventEntity>,
  ) {}

  async recordIfNew(
    input: RecordPaymentEventInput,
  ): Promise<PaymentEvent | null> {
    const row = this.repo.create({
      id: input.id,
      paymentId: input.paymentId,
      provider: input.provider,
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      payload: input.payload,
    });
    try {
      const saved = await this.repo.save(row);
      return PaymentEventMapper.toDomain(saved);
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        // The DB-driver-specific code is on .driverError.code for pg.
        (err as unknown as { driverError?: { code?: string } }).driverError
          ?.code === PG_UNIQUE_VIOLATION
      ) {
        return null;
      }
      throw err;
    }
  }
}
