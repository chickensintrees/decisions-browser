import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchBrowser, snapshot, executeAction } from '../runtime.mjs';
import { verifyResult } from '../verifier.mjs';

test('real browser rejects decoy completion and success invalidated by filter change', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(await readFile(new URL('../fixture.html', import.meta.url), 'utf8'));
    const check = async () => verifyResult(await page.evaluate(() => window.getBenchmarkState()));
    assert.equal((await check()).passed, false);
    await page.getByLabel('City', { exact: true }).selectOption('Lisbon');
    await page.getByLabel('Style', { exact: true }).selectOption('Design');
    await page.getByLabel('Free cancellation', { exact: true }).check();
    const search = (await snapshot(page)).actions.find(a => a.description.startsWith('Click Search.'));
    await executeAction(page, search);
    assert.equal((await check()).passed, false, 'completed search alone must not pass');
    await page.getByRole('button', { name: 'Open Casa Flor', exact: true }).click();
    assert.equal((await check()).passed, false, 'plausible decoy must fail');
    await page.getByRole('button', { name: 'Open Casa Flora', exact: true }).click();
    assert.equal((await check()).passed, true);
    await page.getByLabel('City', { exact: true }).selectOption('Porto');
    assert.equal((await check()).passed, false, 'filter change must revoke old success');
    assert.equal(await page.getByRole('button', { name: 'Open Casa Flora', exact: true }).count(), 0);
  } finally { await browser.close(); }
});
