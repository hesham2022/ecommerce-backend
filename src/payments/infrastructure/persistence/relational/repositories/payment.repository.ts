import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '../../../../domain/payment';
import { PaymentProviderName } from '../../../../domain/payment-enums';
import {
  CreatePaymentInput,
  PaymentAbstractRepository,
  UpdatePaymentStatusInput,
} from '../../payment.abstract.repository';
import { PaymentEntity } from '../entities/payment.entity';
import { PaymentMapper } from '../mappers/payment.mapper';

@Injectable()
export class PaymentRelationalRepository implements PaymentAbstractRepository {
  constructor(
    @InjectRepository(PaymentEntity)
    private readonly repo: Repository<PaymentEntity>,
  ) {}

  async create(input: CreatePaymentInput): Promise<Payment> {
    const row = this.repo.create({
      id: input.id,
      orderId: input.orderId,
      provider: input.provider,
      providerIntentId: input.providerIntentId,
      clientSecret: input.clientSecret,
      status: input.status,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      metadata: input.metadata,
    });
    const saved = await this.repo.save(row);
    return PaymentMapper.toDomain(saved);
  }

  async findById(id: string): Promise<Payment | null> {
    const row = await this.repo.findOne({ where: { id } });
    return row ? PaymentMapper.toDomain(row) : null;
  }

  async findByOrderId(orderId: string): Promise<Payment | null> {
    const row = await this.repo.findOne({ where: { orderId } });
    return row ? PaymentMapper.toDomain(row) : null;
  }

  async findByProviderIntent(
    provider: PaymentProviderName,
    providerIntentId: string,
  ): Promise<Payment | null> {
    const row = await this.repo.findOne({
      where: { provider, providerIntentId },
    });
    return row ? PaymentMapper.toDomain(row) : null;
  }

  async updateStatus(input: UpdatePaymentStatusInput): Promise<Payment> {
    const row = await this.repo.findOne({ where: { id: input.id } });
    if (!row) throw new NotFoundException(`Payment ${input.id} not found`);
    row.status = input.status;
    if (input.lastError !== undefined) row.lastError = input.lastError;
    const saved = await this.repo.save(row);
    return PaymentMapper.toDomain(saved);
  }
}
