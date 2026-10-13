import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTask } from '../src/task-schema.mjs';

const base = { startUrl: 'http://127.0.0.1:4173/catalog', goal: 'Open a record.', checks: [{ type: 'visible', selector: '#detail' }] };
test('task default origin binds to the start page and credentials cannot enter tool arguments', () => {
  assert.deepEqual(normalizeTask(base).allowedOrigins, ['http://127.0.0.1:4173']);
  assert.throws(() => normalizeTask({ ...base, apiKey: 'test-secret' }));
  assert.throws(() => normalizeTask({ ...base, checks: [] }));
});
test('unsafe starting schemes, origin paths, and unmatched start origins are rejected before execution', () => {
  for (const startUrl of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:password@example.test/']) assert.throws(() => normalizeTask({ ...base, startUrl }));
  assert.throws(() => normalizeTask({ ...base, allowedOrigins: ['http://127.0.0.1:4173/path'] }));
  assert.throws(() => normalizeTask({ ...base, allowedOrigins: ['https://example.test'] }));
});
test('unsupported image provider, duplicate text names, and unbounded runs cannot bypass validation', () => {
  assert.throws(() => normalizeTask({ ...base, provider: 'jev', observation: 'image' }));
  assert.throws(() => normalizeTask({ ...base, textValues: [{ name: 'query', value: 'one' }, { name: 'query', value: 'two' }] }));
  assert.throws(() => normalizeTask({ ...base, maxSteps: 10000 }));
  assert.throws(() => normalizeTask({ ...base, timeoutMs: 100000000 }));
});
