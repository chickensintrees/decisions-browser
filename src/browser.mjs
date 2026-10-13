export async function observePage(page, textValues = []) {
  return page.evaluate(values => {
    const isVisible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    const name = el => (el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => document.getElementById(id)?.innerText ?? '').join(' ').trim() || [...(el.labels ?? [])].map(label => label.innerText).join(' ').trim() || el.innerText || el.placeholder || el.name || el.id || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 180);
    const controls = [...document.querySelectorAll('button,a[href],input,textarea,select')].filter(el => isVisible(el) && !el.disabled && !el.readOnly && !['hidden', 'password', 'file'].includes(el.type) && el.getAttribute('aria-disabled') !== 'true');
    const actions = [];
    const formValues = [];
    const add = action => { if (actions.length < 250) actions.push({ id: `a${actions.length}`, ...action }); };
    for (const [index, el] of controls.entries()) {
      const ref = `db-${index}`;
      el.setAttribute('data-decisions-browser-ref', ref);
      const label = name(el);
      if (el.tagName === 'SELECT') {
        formValues.push({ label, value: el.selectedOptions[0]?.textContent.trim() });
        for (const option of el.options) if (!option.disabled && option.value !== el.value) add({ type: 'select', ref, value: option.value, description: `Set ${label} to ${option.textContent.trim()} (currently ${el.selectedOptions[0]?.textContent.trim()})` });
      } else if (el.type === 'checkbox') {
        formValues.push({ label, value: el.checked });
        add({ type: 'check', ref, value: !el.checked, description: `Set ${label} to ${!el.checked ? 'checked' : 'unchecked'} (currently ${el.checked ? 'checked' : 'unchecked'})` });
      } else if (el.type === 'radio') {
        formValues.push({ label, value: el.checked });
        if (!el.checked) add({ type: 'radio', ref, description: `Select ${label} radio option` });
      } else if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && ['text', 'search', 'email', 'tel', 'url', 'number', 'date', 'time', 'datetime-local', 'month', 'week', ''].includes(el.type))) {
        formValues.push({ label, value: el.value.slice(0, 4096) });
        for (const text of values) if (el.value !== text.value) add({ type: 'fill', ref, value: text.value, description: `Fill ${label} with supplied ${text.name}: ${JSON.stringify(text.value)}` });
        if (el.value) add({ type: 'enter', ref, description: `Press Enter in ${label} (current value ${JSON.stringify(el.value.slice(0, 120))})` });
      } else if (el.tagName === 'BUTTON' || el.tagName === 'A' || ['submit', 'button', 'reset'].includes(el.type)) {
        const href = el.tagName === 'A' ? el.href : undefined;
        if (href && !['http:', 'https:'].includes(new URL(href).protocol)) continue;
        const nearby = el.closest('article,tr,li,section')?.innerText.replace(/\s+/g, ' ').slice(0, 500) ?? '';
        add({ type: 'click', ref, ...(href ? { href } : {}), description: `Click ${label}${href ? ` (link ${href})` : ''}. Nearby content: ${nearby}` });
      }
    }
    if (window.scrollY > 0) add({ type: 'scroll', direction: 'up', description: 'Scroll up one viewport to inspect earlier content.' });
    if (window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 5) add({ type: 'scroll', direction: 'down', description: 'Scroll down one viewport to inspect later content.' });
    actions.push({ id: 'WAIT', type: 'wait', description: 'Wait briefly for requested content to load.' });
    actions.push({ id: 'HELP', type: 'help', description: 'Return to the caller because the task is ambiguous or needs unsupported operations.' });
    actions.push({ id: 'DONE', type: 'done', description: 'Finish: all supplied completion checks are satisfied by the current page.' });
    return { url: location.href, title: document.title, text: document.body.innerText.slice(0, 16000), controls: formValues, actions };
  }, textValues);
}

export function sameAction(oldAction, newAction) {
  return !!newAction && ['type', 'ref', 'value', 'href', 'direction', 'description'].every(key => oldAction[key] === newAction[key]);
}

export async function performAction(page, action, signal) {
  signal?.throwIfAborted();
  if (action.type === 'wait') { await page.waitForTimeout(200); return; }
  if (action.type === 'scroll') { await page.evaluate(direction => window.scrollBy(0, (direction === 'up' ? -1 : 1) * window.innerHeight * 0.8), action.direction); return; }
  if (!['click', 'fill', 'select', 'check', 'radio', 'enter'].includes(action.type) || !/^db-\d+$/.test(action.ref)) throw new Error('Invalid action refused before browser input.');
  const target = page.locator(`[data-decisions-browser-ref="${action.ref}"]`);
  if (await target.count() !== 1 || !await target.isVisible() || !await target.isEnabled()) throw new Error('Target changed before browser input.');
  signal?.throwIfAborted();
  if (action.type === 'click') await target.click({ timeout: 3000 });
  if (action.type === 'fill') await target.fill(action.value, { timeout: 3000 });
  if (action.type === 'select') await target.selectOption(action.value, { timeout: 3000 });
  if (action.type === 'check') await target.setChecked(action.value, { timeout: 3000 });
  if (action.type === 'radio') await target.check({ timeout: 3000 });
  if (action.type === 'enter') await target.press('Enter', { timeout: 3000 });
  await page.waitForLoadState('domcontentloaded', { timeout: 3000 });
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 3000 }).catch(error => {
    if (!page.isClosed()) throw error;
  });
}

export async function evaluateChecks(page, checks) {
  return Promise.all(checks.map(async check => {
    try {
      let actual;
      let passed;
      if (check.type === 'url') { actual = page.url(); passed = check.match === 'equals' ? actual === check.value : actual.includes(check.value); }
      else {
        const target = page.locator(check.selector);
        if (check.type === 'visible') { actual = await target.count() === 1 && await target.isVisible(); passed = actual; }
        if (check.type === 'count') { actual = await target.count(); passed = actual === check.value; }
        if (check.type === 'text') { actual = (await target.innerText({ timeout: 1000 })).slice(0, 4000); passed = await target.isVisible() && actual.includes(check.value); }
        if (check.type === 'value') { actual = await target.inputValue({ timeout: 1000 }); passed = actual === check.value; }
        if (check.type === 'checked') { actual = await target.isChecked({ timeout: 1000 }); passed = actual === check.value; }
      }
      return { ...check, actual, passed: !!passed };
    } catch { return { ...check, passed: false, error: 'Check target was missing, ambiguous, or unsupported.' }; }
  }));
}
