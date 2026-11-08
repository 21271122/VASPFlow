import test from 'node:test';
import assert from 'node:assert/strict';
import { planFlags } from './input-builder.js';

test('SD rejects fractional, non-numeric and non-finite atom indices', () => {
  for (const index of [1.5, '1', NaN, Infinity]) {
    assert.match(planFlags(3, [index], undefined).error, /整数/);
    assert.match(planFlags(3, undefined, [index]).error, /整数/);
  }
  assert.deepEqual(planFlags(3, undefined, [1, 2]).flags, ['F   F   F', 'F   F   F', 'T   T   T']);
});
