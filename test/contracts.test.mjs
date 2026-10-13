import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseChoice, validateChoice, choose } from '../providers.mjs';
import { verifyResult } from '../verifier.mjs';

const actions = [{ id: 'a0', description: 'Click Search' }, { id: 'DONE', description: 'Finish' }];
const valid = { searched: true, filters: { city: 'Lisbon', style: 'Design', freeCancellation: true }, detail: { name: 'Casa Flora', city: 'Lisbon', style: 'Design', freeCancellation: true } };

test('independent verification rejects every missing criterion, including plausible wrong hotel', () => {
  assert.equal(verifyResult(valid).passed, true);
  for (const [scope, field, incorrect] of [[null, 'searched', false], ['filters', 'city', 'Porto'], ['filters', 'style', 'Classic'], ['filters', 'freeCancellation', false], ['detail', 'name', 'Casa Flor'], ['detail', 'city', 'Porto'], ['detail', 'style', 'Classic'], ['detail', 'freeCancellation', false]]) {
    const mutant = structuredClone(valid);
    (scope ? mutant[scope] : mutant)[field] = incorrect;
    assert.equal(verifyResult(mutant).passed, false, `${scope}.${field} must matter`);
  }
  assert.equal(verifyResult(null).passed, false);
  assert.equal(verifyResult({ ...valid, detail: null }).passed, false);
});

test('unoffered or wrong-type action cannot reach executor', () => {
  assert.equal(validateChoice('a0', actions).description, 'Click Search');
  for (const invalid of ['click-anything', '__proto__', 0, null, undefined]) assert.throws(() => validateChoice(invalid, actions), /outside/);
});

test('refusals, missing answers, incomplete JSON cannot become actions', () => {
  assert.throws(() => parseChoice('decisions', { answers: [{ name: 'next_action', type: 'refusal' }] }, actions), /refused/);
  assert.throws(() => parseChoice('jev', { answers: {} }, actions), /expected/);
  assert.throws(() => parseChoice('responses', { status: 'incomplete', output: [] }, actions), /complete/);
  assert.throws(() => parseChoice('responses', { status: 'completed', output: [{ content: [{ type: 'output_text', text: 'DONE' }] }] }, actions), /invalid/);
  assert.throws(() => parseChoice('decisions', { answers: [{ name: 'next_action', type: 'choice', choice: 'a0', confidence: NaN }] }, actions), /confidence/);
});

test('documented choice responses normalize without silently changing chosen value', () => {
  assert.equal(parseChoice('decisions', { answers: [{ name: 'next_action', type: 'choice', choice: 'a0', confidence: 0.9 }] }, actions).choice, 'a0');
  assert.equal(parseChoice('jev', { answers: { next_action: { type: 'choice', choice: 'a0', confidence: 0.9 } } }, actions).choice, 'a0');
  assert.equal(parseChoice('responses', { status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"choice":"a0"}' }] }] }, actions).choice, 'a0');
});

test('malformed choice space and unknown provider fail before any API request', () => {
  assert.throws(() => buildRequest('decisions', {}, [actions[0]]), /between/);
  assert.throws(() => buildRequest('decisions', {}, [actions[0], actions[0]]), /unique/);
  assert.throws(() => buildRequest('unknown', {}, actions), /Unsupported/);
});

test('HTTP error body cannot echo credentials into logs', async () => {
  const credential = 'sk-test-DO_NOT_LOG';
  await assert.rejects(choose('decisions', {}, actions, { key: credential, fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: credential } }), { status: 401 }) }), error => {
    assert.match(error.message, /HTTP 401/);
    assert.equal(error.message.includes(credential), false);
    return true;
  });
});

test('missing credentials make zero network calls', async () => {
  let calls = 0;
  await assert.rejects(choose('decisions', {}, actions, { fetchImpl: async () => { calls++; } }), /Missing/);
  assert.equal(calls, 0);
});

test('image evidence uses image parts in both OpenAI endpoints and cannot reach text-only Jev', () => {
  const state = { goal: 'Choose the visible control.', screenshotDataUrl: 'data:image/png;base64,TEST' };
  for (const provider of ['decisions', 'responses']) {
    const { body } = buildRequest(provider, state, actions);
    assert.equal(body.input[0].content[1].type, 'input_image');
    assert.equal(body.input[0].content[1].image_url, state.screenshotDataUrl);
    assert.equal(body.input[0].content[0].text.includes('data:image'), false);
  }
  assert.throws(() => buildRequest('jev', state, actions), /text only/);
});
