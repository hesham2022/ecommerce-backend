export interface SettingsShape {
  multi_region_enabled: boolean;
  vendors_auto_approve: boolean;
  products_auto_approve: boolean;
  default_region_code: string;
  default_locale_code: string;
  payout_hold_days: number;
  payout_minimum_amount_minor: string; // bigint as string
  payout_cycle_cron: string; // informational only in v1; cron is hardcoded
  payout_default_commission_rate: string; // decimal as string, e.g., "0.1000"
}

export const DEFAULT_SETTINGS: SettingsShape = {
  multi_region_enabled: false,
  vendors_auto_approve: false,
  products_auto_approve: false,
  default_region_code: 'SA',
  default_locale_code: 'ar',
  payout_hold_days: 14,
  payout_minimum_amount_minor: '5000',
  payout_cycle_cron: '0 9 * * 1',
  payout_default_commission_rate: '0.1000',
};

// Subset safe to expose on the public endpoint
export type PublicSettingsShape = Pick<
  SettingsShape,
  'multi_region_enabled' | 'default_region_code' | 'default_locale_code'
>;
