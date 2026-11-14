export const MAX_DELIVERY_ATTEMPTS = 8;
const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;
const RETRY_JITTER_MS = 250;

export function shouldRetryDelivery(attempt: number): boolean {
  return Number.isInteger(attempt) && attempt >= 1 && attempt < MAX_DELIVERY_ATTEMPTS;
}

export function getDeliveryRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError('attempt must be a positive integer');
  const backoff = Math.min(BASE_RETRY_MS * (2 ** (attempt - 1)), MAX_RETRY_MS);
  return backoff + Math.floor(random() * RETRY_JITTER_MS);
}
