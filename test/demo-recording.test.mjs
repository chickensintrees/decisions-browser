import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createTimingState, readPassiveChecks, createSessionControl, createCaptureLimits, startCaptureAfterFirstFrame, beginCaptureWithFrameHandshake } from '../scripts/record-demo.mjs';

test('capture initializes before navigation while timing waits for the page paint frame', async () => {
  const events = [];
  let emitFrame;
  const page = { screencast: { start: async options => { emitFrame = options.onFrame; events.push('capture-start'); }, stop: async () => {} } };
  const capture = await beginCaptureWithFrameHandshake(page, { path: 'unused.webm', onFrame: () => events.push('page-painted'), timeoutMs: 1000 });
  assert.deepEqual(events, ['capture-start']);
  events.push('navigation-ready');
  emitFrame({ timestamp: 1800000000000 });
  await capture.frameReady;
  events.push('arm');
  assert.deepEqual(events, ['capture-start', 'navigation-ready', 'page-painted', 'arm']);
});

test('first recording frame is acknowledged before the caller can arm timing', async () => {
  let emitFrame;
  const events = [];
  const page = {
    screencast: { start: async options => { emitFrame = options.onFrame; events.push('capture-start'); }, stop: async () => {} },
    screenshot: async () => {}
  };
  const ready = startCaptureAfterFirstFrame(page, { path: 'unused.webm', onFrame: () => events.push('first-frame'), timeoutMs: 1000 }).then(() => events.push('arm'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['capture-start'], 'Recorder setup must not return before an actual frame.');
  emitFrame({ timestamp: 1800000000000 });
  await ready;
  assert.deepEqual(events, ['capture-start', 'first-frame', 'arm']);
});

test('missing first frame fails setup and stops the incomplete capture', async () => {
  let stops = 0;
  const page = {
    screencast: { start: async () => {}, stop: async () => { stops += 1; } },
    screenshot: async () => {}
  };
  await assert.rejects(startCaptureAfterFirstFrame(page, { path: 'unused.webm', timeoutMs: 20 }), /first frame.*deadline/);
  assert.equal(stops, 1);
});

test('capture deadline allows setup and starts its 180-second bound only after arming', () => {
  const scheduled = [];
  const cancelled = [];
  const reasons = [];
  const limits = createCaptureLimits(reason => reasons.push(reason), {
    schedule: (callback, delay) => { const timer = { callback, delay }; scheduled.push(timer); return timer; },
    cancel: timer => cancelled.push(timer)
  });
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 600000);
  assert.deepEqual(reasons, []);
  limits.arm();
  assert.equal(cancelled[0], scheduled[0]);
  assert.equal(scheduled[1].delay, 180000);
  limits.arm();
  assert.equal(scheduled.length, 2, 'Repeated start must not extend the measured run.');
  scheduled[1].callback();
  assert.deepEqual(reasons, ['180-second-armed-capture-limit']);
  limits.close();
  assert.equal(cancelled.at(-1), scheduled[1]);
});

test('recording clock starts once, ignores early/incomplete checks and freezes at independently verified completion', () => {
  let monotonic = 10;
  let epoch = 1800000000000;
  const clock = createTimingState({ lane: 'test', checks: [{ type: 'visible' }, { type: 'text' }], now: () => monotonic, epochNow: () => epoch });
  clock.frame(epoch);
  assert.equal(clock.observe([{ passed: true }, { passed: true }]), false);
  epoch += 250;
  clock.arm();
  assert.equal(clock.metadata.videoStartOffsetMs, 250);
  monotonic += 100;
  epoch += 100;
  clock.arm();
  assert.equal(clock.observe([{ passed: true }]), false);
  assert.equal(clock.observe([{ passed: true }, { passed: false }]), false);
  monotonic += 900;
  epoch += 900;
  assert.equal(clock.observe([{ passed: true }, { passed: true }]), true);
  assert.equal(clock.metadata.verifiedDurationMs, 1000);
  monotonic += 2000;
  assert.equal(clock.observe([{ passed: true }, { passed: true }]), false);
  assert.equal(clock.metadata.verifiedDurationMs, 1000);
});

test('passive observer checks actual DOM values and rejects each wrong criterion', async () => {
  const element = { innerText: 'Casa Flora', value: 'flora', checked: true, getClientRects: () => [{}] };
  const page = { evaluate: async (fn, checks) => vm.runInNewContext(`(${fn.toString()})(checks)`, {
    checks, location: { href: 'http://fixture.test/detail' }, document: { querySelectorAll: selector => selector === '#hotel' ? [element] : [] }, getComputedStyle: () => ({ visibility: 'visible', display: 'block' })
  }) };
  const good = [
    { type: 'visible', selector: '#hotel' }, { type: 'text', selector: '#hotel', value: 'Casa Flora' },
    { type: 'value', selector: '#hotel', value: 'flora' }, { type: 'checked', selector: '#hotel', value: true },
    { type: 'count', selector: '#hotel', value: 1 }, { type: 'url', value: '/detail', match: 'contains' }
  ];
  assert.ok((await readPassiveChecks(page, good)).every(check => check.passed));
  const wrong = [
    { type: 'visible', selector: '#missing' }, { type: 'text', selector: '#hotel', value: 'Porto' },
    { type: 'value', selector: '#hotel', value: 'wrong' }, { type: 'checked', selector: '#hotel', value: false },
    { type: 'count', selector: '#hotel', value: 2 }, { type: 'url', value: '/wrong', match: 'contains' }
  ];
  assert.ok((await readPassiveChecks(page, wrong)).every(check => !check.passed));
});

test('baseline control endpoint only arms and finalizes the recorder', async () => {
  let starts = 0;
  let finishes = 0;
  let arms = 0;
  const recorder = { metadata: { verified: false }, arm: () => { starts += 1; return { armed: true }; }, finish: async () => { finishes += 1; return { verified: true, videoPath: 'raw.webm' }; } };
  const control = await createSessionControl(recorder, { onStart: () => { arms += 1; } });
  try {
    assert.equal((await fetch(control.url + '/status')).status, 200);
    assert.equal(starts, 0);
    assert.equal(finishes, 0);
    const start = await fetch(control.url + '/start', { method: 'POST' }).then(response => response.json());
    assert.equal(start.armed, true);
    await fetch(control.url + '/start', { method: 'POST' });
    const finish = await fetch(control.url + '/finish', { method: 'POST' }).then(response => response.json());
    assert.equal(finish.verified, true);
    await control.finished;
    assert.equal(starts, 2);
    assert.equal(arms, 1, 'Repeated start requests must not extend the capture deadline.');
    assert.equal(finishes, 1);
  } finally { await control.close(); }
});
