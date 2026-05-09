export enum PaymentProviderName {
  STRIPE = 'STRIPE',
  TAP = 'TAP',
  HYPERPAY = 'HYPERPAY',
}

export enum PaymentStatus {
  REQUIRES_ACTION = 'REQUIRES_ACTION',
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELED = 'CANCELED',
}
