// src/payouts/payout-cron.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PayoutService } from './payout.service';
import { formatISOWeek } from './cycle-key';

@Injectable()
export class PayoutCronService {
  private readonly logger = new Logger(PayoutCronService.name);

  constructor(private readonly service: PayoutService) {}

  // Monday 09:00 (server TZ). Note: settings.payout_cycle_cron is informational in v1 —
  // changing the value does not change the schedule without a deploy. Dynamic scheduling
  // via SchedulerRegistry is a future enhancement.
  @Cron('0 9 * * 1', { name: 'payout-weekly' })
  async runWeekly(): Promise<void> {
    const cycleKey = formatISOWeek(new Date());
    this.logger.log(`Running weekly payouts for cycle ${cycleKey}`);
    try {
      const { batchId } = await this.service.issuePayoutsForCycle(cycleKey);
      this.logger.log(`Cycle ${cycleKey} produced batch ${batchId}`);
    } catch (err) {
      this.logger.error(
        `Cycle ${cycleKey} failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
