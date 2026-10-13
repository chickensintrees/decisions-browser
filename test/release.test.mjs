import test from 'node:test';
import assert from 'node:assert/strict';
import { findPublicLeaks } from '../scripts/release-policy.mjs';
test('public-source detector has proven positive controls for credentials and personal paths', () => {
  assert.deepEqual(findPublicLeaks('const credential = process.env.OPENAI_API_KEY;'), []);
  assert.match(findPublicLeaks('sk-proj-' + 'A'.repeat(48))[0], /credential/);
  assert.match(findPublicLeaks('C:' + '/Users/' + 'Example/Desktop/private.key')[0], /filesystem/);
  assert.deepEqual(findPublicLeaks('sk-test-' + 'A'.repeat(48)), []);
});
