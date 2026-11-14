import assert from 'node:assert/strict';
import { getDeliveryRetryDelayMs, MAX_DELIVERY_ATTEMPTS, shouldRetryDelivery } from '../dist/services/retry-policy.js';

assert.equal(MAX_DELIVERY_ATTEMPTS, 8);
for (let attempt = 1; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
  const expected = Math.min(1_000 * (2 ** (attempt - 1)), 60_000);
  assert.equal(getDeliveryRetryDelayMs(attempt, () => 0), expected);
  assert.ok(getDeliveryRetryDelayMs(attempt, () => 0.999999) < expected + 250);
  assert.equal(shouldRetryDelivery(attempt), true);
}
assert.equal(shouldRetryDelivery(MAX_DELIVERY_ATTEMPTS), false);
assert.equal(shouldRetryDelivery(0), false);
assert.throws(() => getDeliveryRetryDelayMs(0), RangeError);

console.log('Retry policy checks passed.');
