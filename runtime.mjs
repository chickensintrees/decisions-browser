import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  const bundled = process.env.PLAYWRIGHT_MODULE_PATH;
  if (bundled && existsSync(bundled)) return require(bundled);
  throw new Error('Playwright unavailable. Run npm install, or set PLAYWRIGHT_MODULE_PATH to the installed package directory.');
}

export async function serveFixture() {
  const html = await readFile(new URL('./fixture.html', import.meta.url));
  const server = createServer((request, response) => {
    if (request.url !== '/' && request.url !== '/fixture.html') { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/fixture.html`, close: () => new Promise(resolve => server.close(resolve)) };
}

export async function launchBrowser({ headless = true, timeout = 30000 } = {}) {
  const { chromium } = await loadPlaywright();
  const executablePath = process.env.BENCH_BROWSER_PATH ?? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].find(existsSync);
  return chromium.launch({ headless, timeout, ...(executablePath ? { executablePath } : {}) });
}

export async function snapshot(page) {
  return page.evaluate(() => {
    const actions = [];
    const controls = [...document.querySelectorAll('select,input[type=checkbox],button')].filter(el => el.getClientRects().length && !el.disabled);
    const label = el => el.getAttribute('aria-label') || [...(el.labels ?? [])].map(l => l.innerText).join(' ') || el.innerText || el.id;
    for (const [index, el] of controls.entries()) {
      const ref = `control-${index}`;
      el.setAttribute('data-bench-ref', ref);
      const name = label(el).trim().replace(/\s+/g, ' ');
      if (el.tagName === 'SELECT') {
        for (const option of el.options) {
          if (option.disabled || option.value === el.value) continue;
          actions.push({ id: `a${actions.length}`, type: 'select', ref, value: option.value, description: `Set ${name} to ${option.textContent.trim()} (currently ${el.selectedOptions[0]?.textContent.trim()})` });
        }
      } else if (el.type === 'checkbox') {
        actions.push({ id: `a${actions.length}`, type: 'check', ref, value: !el.checked, description: `Set ${name} to ${!el.checked ? 'checked' : 'unchecked'} (currently ${el.checked ? 'checked' : 'unchecked'})` });
      } else {
        const context = el.closest('article,section')?.innerText.replace(/\s+/g, ' ').slice(0, 500) ?? '';
        actions.push({ id: `a${actions.length}`, type: 'click', ref, description: `Click ${name}. Nearby visible content: ${context}` });
      }
    }
    actions.push({ id: 'WAIT', type: 'wait', description: 'Wait for the current loading operation to finish.' });
    actions.push({ id: 'DONE', type: 'done', description: 'Finish: the requested filters, completed search, and correct hotel detail are all visible.' });
    const values = controls.filter(el => el.tagName === 'SELECT' || el.type === 'checkbox').map(el => ({
      label: label(el).trim().replace(/\s+/g, ' '), value: el.type === 'checkbox' ? el.checked : el.selectedOptions[0]?.textContent.trim()
    }));
    return { text: document.body.innerText, controls: values, actions };
  });
}

export async function executeAction(page, action) {
  if (!['select', 'check', 'click', 'wait', 'done'].includes(action.type)) throw new Error('Unknown action type. No input executed.');
  if (action.type === 'done') return;
  if (action.type === 'wait') { await page.waitForTimeout(120); return; }
  if (!/^control-\d+$/.test(action.ref)) throw new Error('Invalid control reference. No input executed.');
  const target = page.locator(`[data-bench-ref="${action.ref}"]`);
  if (action.type === 'select') await target.selectOption(action.value, { timeout: 3000 });
  if (action.type === 'check') await target.setChecked(action.value, { timeout: 3000 });
  if (action.type === 'click') await target.click({ timeout: 3000 });
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 3000 });
}

export const fixturePath = fileURLToPath(new URL('./fixture.html', import.meta.url));
