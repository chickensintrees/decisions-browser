import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createServer } from 'node:http';
import { runBrowserTask } from '../src/controller.mjs';
import { launchBrowser } from '../runtime.mjs';
import { startFixtures } from './fixtures/server.mjs';

let fixture;
before(async () => { fixture = await startFixtures(); });
after(async () => { await fixture.close(); });

const credentialLoader = async () => 'offline-fixture-key';
const options = chooseAction => ({ chooseAction, credentialLoader, browserFactory: launchBrowser });
const match = (type, ...parts) => action => action.type === type && parts.every(part => action.description.includes(part));
const done = actions => actions.find(action => action.id === 'DONE' || action.type === 'done');

function plannedChooser(plan, selected = []) {
  let step = 0;
  return async (provider, state, actions, requestOptions) => {
    assert.equal(provider, 'decisions');
    assert.equal(requestOptions.key, 'offline-fixture-key');
    assert.ok(state.goal);
    assert.ok(!Object.hasOwn(state, 'checks'), 'Completion assertions must not enter chooser evidence.');
    assert.ok(!Object.hasOwn(state, 'verified'), 'Verification output must not enter chooser evidence.');
    const predicate = plan[step];
    const action = predicate ? actions.find(predicate) : done(actions);
    assert.ok(action, `Expected action ${step + 1}; offered: ${actions.map(action => action.description).join(' | ')}`);
    selected.push(action.type);
    step += 1;
    return { choice: action.id, latencyMs: 0, model: 'offline-test-chooser' };
  };
}

async function example(name) {
  const task = JSON.parse(await readFile(new URL(`../examples/tasks/${name}.json`, import.meta.url), 'utf8'));
  task.startUrl = fixture.origin + new URL(task.startUrl).pathname;
  return task;
}

function task(path, checks, extra = {}) {
  return { startUrl: fixture.origin + path, goal: 'Inspect this local fixture and finish only when the requested outcome is visible.', checks, ...extra };
}

test('catalog task fills query, selects city, checks policy, selects radio, searches and follows a record link', { timeout: 30000 }, async () => {
  const selected = [];
  const chooseAction = plannedChooser([
    match('fill', 'Search inventory', 'flora'),
    match('select', 'City', 'Lisbon'),
    match('check', 'Free cancellation'),
    match('radio', 'Design'),
    match('click', 'Search catalog'),
    action => action.type === 'click' && /Open Casa Flora(?:\.|\b)/.test(action.description) && !/Open Casa Flora (?:Porto|Annex)/.test(action.description)
  ], selected);
  const result = await runBrowserTask(await example('catalog'), options(chooseAction));
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.verified, true);
  assert.deepEqual(selected, ['fill', 'select', 'check', 'radio', 'click', 'click', 'done']);
  assert.ok(fixture.requests.some(request => request.startsWith('/catalog/search?') && request.includes('query=flora') && request.includes('city=Lisbon') && request.includes('style=Design') && request.includes('freeCancellation=true')), 'The actual search request must carry all requested filters.');
  assert.ok(fixture.requests.some(request => request.startsWith('/catalog/record/casa-flora?')), 'The browser must navigate to the detail page.');
});

test('queue task uses Enter to submit and opens the correct readonly record', { timeout: 30000 }, async () => {
  const selected = [];
  const chooseAction = plannedChooser([
    match('select', 'Status', 'Open'),
    match('check', 'Only unassigned'),
    match('fill', 'Ticket query', 'maintenance'),
    match('enter', 'Ticket query'),
    match('click', 'Open ticket 417')
  ], selected);
  const result = await runBrowserTask(await example('queue'), options(chooseAction));
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.verified, true);
  assert.deepEqual(selected, ['select', 'check', 'fill', 'enter', 'click', 'done']);
  assert.ok(fixture.requests.some(request => request.startsWith('/queue/search?') && request.includes('query=maintenance') && request.includes('status=Open') && request.includes('unassigned=true')), 'Enter must trigger the search with the actual applied filters.');
});

test('premature DONE fails independent completion checks', { timeout: 15000 }, async () => {
  const result = await runBrowserTask(await example('catalog'), options(plannedChooser([])));
  assert.equal(result.status, 'verification_failed', JSON.stringify(result));
  assert.equal(result.verified, false);
  assert.ok(result.checks.length > 0);
});

test('each DOM and URL check detects a deliberately wrong outcome', { timeout: 60000 }, async () => {
  const path = '/catalog/record/casa-flora?query=flora&city=Lisbon&style=Design&freeCancellation=true';
  const positive = [
    { type: 'visible', selector: '#detail-name' },
    { type: 'text', selector: '#detail-name', value: 'Casa Flora' },
    { type: 'value', selector: '#detail-query', value: 'flora' },
    { type: 'checked', selector: '#detail-free', value: true },
    { type: 'url', value: fixture.origin + path, match: 'equals' },
    { type: 'count', selector: '#detail-name', value: 1 }
  ];
  const pass = await runBrowserTask(task(path, positive), options(plannedChooser([])));
  assert.equal(pass.status, 'completed', JSON.stringify(pass));
  const negative = [
    { type: 'visible', selector: '#missing-detail' },
    { type: 'text', selector: '#detail-name', value: 'Casa Flora Porto' },
    { type: 'value', selector: '#detail-query', value: 'wrong query' },
    { type: 'checked', selector: '#detail-free', value: false },
    { type: 'url', value: fixture.origin + '/wrong-record', match: 'equals' },
    { type: 'count', selector: '#detail-name', value: 2 }
  ];
  for (const check of negative) {
    const result = await runBrowserTask(task(path, [check]), options(plannedChooser([])));
    assert.equal(result.status, 'verification_failed', `Broken ${check.type} detector: ${JSON.stringify(result)}`);
    assert.equal(result.verified, false);
  }
});

test('a one-step bound cannot execute the full workflow', { timeout: 15000 }, async () => {
  const input = { ...await example('catalog'), maxSteps: 1 };
  const result = await runBrowserTask(input, options(plannedChooser([match('fill', 'Search inventory', 'flora')])));
  assert.equal(result.status, 'step_limit', JSON.stringify(result));
  assert.equal(result.verified, false);
});

function pendingChooser(onStarted) {
  return async (provider, state, actions, requestOptions) => {
    const signal = requestOptions.signal;
    assert.ok(signal, 'The chooser needs the task abort signal.');
    onStarted(signal);
    return new Promise((resolve, reject) => {
      const abort = () => { const error = new Error('Pending chooser stopped'); error.name = 'AbortError'; reject(error); };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  };
}

test('cancellation interrupts a pending chooser', { timeout: 15000 }, async () => {
  const abort = new AbortController();
  let chooserSignal;
  let announce;
  const started = new Promise(resolve => { announce = resolve; });
  const chooseAction = pendingChooser(signal => { chooserSignal = signal; announce(); });
  const running = runBrowserTask(task('/catalog', [{ type: 'visible', selector: '#catalog-results' }], { timeoutMs: 10000 }), { ...options(chooseAction), signal: abort.signal });
  await Promise.race([started, new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Chooser never started')), 5000); timer.unref(); })]);
  const stopStarted = performance.now();
  abort.abort();
  const result = await running;
  assert.equal(result.status, 'cancelled', JSON.stringify(result));
  assert.equal(result.verified, false);
  assert.equal(chooserSignal.aborted, true);
  assert.ok(performance.now() - stopStarted < 3000, 'Cancellation must not wait for the normal chooser timeout.');
});

test('task deadline interrupts a pending chooser', { timeout: 15000 }, async () => {
  let chooserSignal;
  const browser = await launchBrowser();
  try {
    const begin = performance.now();
    const result = await runBrowserTask(task('/catalog', [{ type: 'visible', selector: '#catalog-results' }], { timeoutMs: 1000 }), {
      ...options(pendingChooser(signal => { chooserSignal = signal; })), browserFactory: async () => browser
    });
    assert.equal(result.status, 'timed_out', JSON.stringify(result));
    assert.equal(result.verified, false);
    assert.equal(chooserSignal?.aborted, true);
    assert.ok(performance.now() - begin < 4000, 'The whole task must honor its deadline.');
  } finally { await browser.close(); }
});

test('task deadline interrupts pending credential loading before any browser is created', { timeout: 5000 }, async () => {
  let credentialStarted = false;
  let browserCalls = 0;
  const begin = performance.now();
  const result = await runBrowserTask(task('/catalog', [{ type: 'visible', selector: 'body' }], { timeoutMs: 1000 }), {
    credentialLoader: () => { credentialStarted = true; return new Promise(() => {}); },
    browserFactory: async () => { browserCalls += 1; throw new Error('Browser must never launch.'); },
    chooseAction: async () => { throw new Error('Chooser must never run.'); }
  });
  assert.equal(credentialStarted, true);
  assert.equal(result.status, 'timed_out', JSON.stringify(result));
  assert.equal(result.verified, false);
  assert.equal(browserCalls, 0);
  assert.ok(performance.now() - begin < 2500, 'Startup dependency waits must count toward the task deadline.');
});

test('cancelling pending browser creation disposes a browser that resolves later', { timeout: 5000 }, async () => {
  const abort = new AbortController();
  let announce;
  const started = new Promise(resolve => { announce = resolve; });
  let releaseBrowser;
  const pendingBrowser = new Promise(resolve => { releaseBrowser = resolve; });
  let closeCalls = 0;
  let contextCalls = 0;
  const fakeBrowser = {
    close: async () => { closeCalls += 1; },
    newContext: async () => { contextCalls += 1; throw new Error('Cancelled browser must not create a context.'); }
  };
  const running = runBrowserTask(task('/catalog', [{ type: 'visible', selector: 'body' }], { timeoutMs: 10000 }), {
    signal: abort.signal,
    credentialLoader,
    browserFactory: () => { announce(); return pendingBrowser; },
    chooseAction: async () => { throw new Error('Chooser must never run.'); }
  });
  try {
    await started;
    abort.abort();
    const result = await Promise.race([
      running,
      new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Cancellation waited for browser startup')), 1000); timer.unref(); })
    ]);
    assert.equal(result.status, 'cancelled', JSON.stringify(result));
    assert.equal(result.verified, false);
    assert.equal(closeCalls, 0, 'The pending browser has not resolved yet.');
    releaseBrowser(fakeBrowser);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closeCalls, 1, 'A browser resolving after cancellation must be closed exactly once.');
    assert.equal(contextCalls, 0);
  } finally { releaseBrowser(fakeBrowser); }
});

test('cross-origin links are not offered as actions', { timeout: 15000 }, async () => {
  const beforeHits = fixture.foreignRequests.length;
  const chooser = async (provider, state, actions) => {
    assert.ok(!actions.some(action => action.type === 'click' && action.description.includes('External destination')), 'A disallowed-origin link must never reach the action chooser.');
    return { choice: done(actions).id, latencyMs: 0 };
  };
  const result = await runBrowserTask(task('/outside-link', [{ type: 'text', selector: '#origin-note', value: 'Original origin' }]), options(chooser));
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(fixture.foreignRequests.length, beforeHits);
});

test('JavaScript cross-origin navigation is intercepted before transmission', { timeout: 15000 }, async () => {
  const beforeHits = fixture.foreignRequests.length;
  const result = await runBrowserTask(task('/outside-navigation', [{ type: 'url', value: fixture.foreignOrigin, match: 'contains' }]), options(plannedChooser([match('click', 'Open external page')])));
  assert.notEqual(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.verified, false);
  assert.equal(fixture.foreignRequests.length, beforeHits, 'The foreign server must receive zero navigation requests.');
});

test('JavaScript cross-origin fetch is intercepted before transmission', { timeout: 15000 }, async () => {
  const beforeHits = fixture.foreignRequests.length;
  const result = await runBrowserTask(task('/outside-request', [{ type: 'text', selector: '#request-status', value: 'Request blocked' }]), options(plannedChooser([match('click', 'Load external reference')])));
  assert.equal(fixture.foreignRequests.length, beforeHits, 'The foreign server must receive zero fetch requests.');
  assert.notEqual(result.status, 'timed_out', JSON.stringify(result));
});

async function startRedirectFixture() {
  const requests = [];
  let origin;
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/direct') return response.writeHead(302, { Location: fixture.foreignOrigin + '/direct-redirect-target' }).end();
    if (request.url === '/chain') return response.writeHead(302, { Location: origin + '/hop' }).end();
    if (request.url === '/hop') return response.writeHead(302, { Location: fixture.foreignOrigin + '/chain-redirect-target' }).end();
    if (request.url === '/same-origin') return response.writeHead(302, { Location: origin + '/final' }).end();
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<p id="redirect-target">Redirect reached its destination</p>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, requests, close: () => new Promise(resolve => server.close(resolve)) };
}

for (const [path, description] of [
  ['/direct', 'direct HTTP redirect to a foreign origin'],
  ['/chain', 'HTTP redirect chain through the allowed origin'],
  ['/same-origin', 'same-origin HTTP redirect']
]) {
  test(`${description} fails closed before following any hop`, { timeout: 15000 }, async () => {
    const redirect = await startRedirectFixture();
    const beforeHits = fixture.foreignRequests.length;
    try {
      const input = {
        startUrl: redirect.origin + path,
        goal: 'Inspect the starting local page without leaving its permitted origin.',
        checks: [{ type: 'visible', selector: '#redirect-target' }]
      };
      const result = await runBrowserTask(input, options(plannedChooser([])));
      assert.notEqual(result.status, 'completed', JSON.stringify(result));
      assert.equal(result.verified, false);
      assert.equal(fixture.foreignRequests.length, beforeHits, 'A redirect must not transmit a request to the foreign server.');
      assert.deepEqual(redirect.requests, [path], 'Version 0.1 must reject the first redirect rather than automatically following any hop.');
    } finally { await redirect.close(); }
  });
}

test('WebSocket boundary blocks a handshake that the positive control can detect', { timeout: 15000 }, async () => {
  const hits = [];
  const foreign = createServer((request, response) => response.end('WebSocket fixture'));
  foreign.on('upgrade', (request, socket) => { hits.push(request.url); socket.destroy(); });
  await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
  const socketUrl = `ws://127.0.0.1:${foreign.address().port}/socket`;
  const home = createServer((request, response) => response.writeHead(200, { 'Content-Type': 'text/html' }).end(`<p id="socket-ready">Ready</p><script>window.socket=new WebSocket(${JSON.stringify(socketUrl)})</script>`));
  await new Promise(resolve => home.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${home.address().port}`;
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => window.socket.readyState === WebSocket.CLOSED, null, { timeout: 3000 });
    assert.deepEqual(hits, ['/socket'], 'The unrestricted positive control must prove the handshake detector can fail.');
    await browser.close();
    browser = null;
    hits.length = 0;
    const chooseAction = async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return { choice: 'DONE', latencyMs: 0 };
    };
    const result = await runBrowserTask({ startUrl: origin, goal: 'Read the Ready marker on the permitted page.', checks: [{ type: 'visible', selector: '#socket-ready' }] }, options(chooseAction));
    assert.equal(result.status, 'completed', JSON.stringify(result));
    assert.deepEqual(hits, [], 'The controller must block the foreign handshake before any request reaches the server.');
    assert.ok(result.blockedRequests.some(request => request.resourceType === 'websocket'), 'The blocked WebSocket must be reported.');
  } finally {
    await browser?.close();
    await Promise.all([new Promise(resolve => home.close(resolve)), new Promise(resolve => foreign.close(resolve))]);
  }
});

test('password controls are excluded even when a matching supplied value exists', { timeout: 15000 }, async () => {
  let chooserCalled = false;
  const chooser = async (provider, state, actions) => {
    chooserCalled = true;
    assert.ok(!actions.some(action => /^(?:Fill|Press Enter in) Password\b/.test(action.description)), 'Password inputs must not become executable actions.');
    assert.ok(!state.controls.some(control => control.label === 'Password'), 'Password values must not appear in form-control observations.');
    return { choice: done(actions).id, latencyMs: 0 };
  };
  const result = await runBrowserTask(task('/password', [{ type: 'value', selector: '#password', value: '' }], { textValues: [{ name: 'Password', value: 'offline-secret-sentinel' }] }), options(chooser));
  assert.equal(chooserCalled, true);
  assert.equal(result.status, 'completed', JSON.stringify(result));
});

test('a changed control cannot execute the stale action selected earlier', { timeout: 15000 }, async () => {
  const beforeDeletes = fixture.requests.filter(request => request.startsWith('/event?operation=delete')).length;
  let page;
  const browserFactory = async () => {
    const browser = await launchBrowser();
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await newContext(options);
      context.on('page', createdPage => { page = createdPage; });
      return context;
    };
    return browser;
  };
  let count = 0;
  const chooser = async (provider, state, actions) => {
    if (count++ === 0) {
      const action = actions.find(match('click', 'Open record'));
      assert.ok(action);
      assert.ok(page);
      await page.evaluate(() => {
        const control = document.querySelector('#record-control');
        control.textContent = 'Delete record';
        control.dataset.operation = 'delete';
      });
      return { choice: action.id, latencyMs: 0 };
    }
    return { choice: done(actions).id, latencyMs: 0 };
  };
  const result = await runBrowserTask(task('/stale', [{ type: 'text', selector: '#operation-result', value: 'Opened record' }]), { chooseAction: chooser, credentialLoader, browserFactory });
  assert.notEqual(result.status, 'completed', JSON.stringify(result));
  assert.equal(fixture.requests.filter(request => request.startsWith('/event?operation=delete')).length, beforeDeletes, 'The stale choice must never activate the replacement operation.');
});
