import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { launchBrowser } from '../runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'campaign', 'creative');
const iteration = process.argv.includes('--iteration') ? process.argv[process.argv.indexOf('--iteration') + 1] : 'final';
if (!/^[a-zA-Z0-9-]+$/.test(iteration)) throw new Error('Invalid iteration name.');
const renderDirectory = iteration === 'final' ? output : join(root, 'artifacts', 'campaign', 'creative-review', iteration);
await mkdir(join(output, 'assets'), { recursive: true });
await mkdir(renderDirectory, { recursive: true });
if (process.argv.includes('--pdf-only')) {
  const slideNames = ['04-carousel-01-hook', '05-carousel-02-proof', '06-carousel-03-harness', '07-carousel-04-cta'];
  const documents = await Promise.all(slideNames.map(name => readFile(join(output, name + '.html'), 'utf8')));
  const sharedStyles = documents[0].match(/<style>([\s\S]*?)<\/style>/)[1];
  const slides = documents.map(document => document.match(/<main[\s\S]*?<\/main>/)[0]);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Decisions Browser — one recorded browser workflow</title><style>${sharedStyles}\n@page{size:1080px 1350px;margin:0}html,body{margin:0;padding:0;background:white}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}.art{break-after:page;page-break-after:always}.art:last-child{break-after:auto;page-break-after:auto}</style></head><body>${slides.join('\n')}</body></html>`;
  await writeFile(join(output, 'carousel.html'), html);
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
    await page.goto(pathToFileURL(join(output, 'carousel.html')).href);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('main.art').count(), 4);
    assert.ok(await page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), 'All proof images must load.');
    await page.pdf({ path: join(output, 'decisions-browser-carousel.pdf'), printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, tagged: true });
  } finally { await browser.close(); }
  console.log(JSON.stringify({ file: 'campaign/creative/decisions-browser-carousel.pdf', slides: 4, canvas: { width: 1080, height: 1350 } }));
  process.exit(0);
}
for (const [source, destination] of [['fast-finished.png', 'demo-fast-finished.png'], ['both-finished.png', 'demo-both-finished.png']]) {
  await copyFile(join(root, 'artifacts', 'demo', '2026-10-15', source), join(output, 'assets', destination));
}

const styles = `
*{box-sizing:border-box}html,body{margin:0;padding:0}body{background:#d7d9d9;font-family:Arial,Helvetica,sans-serif;color:#141b25}a{color:inherit}.art{position:relative;overflow:hidden;background:#f2f0e7;width:var(--w);height:var(--h);padding:60px}.ink{background:#111923;color:#f2f0e7}.brand{display:flex;align-items:center;gap:16px;font-size:25px;font-weight:700;letter-spacing:-.5px}.mark{font-size:34px;letter-spacing:-6px;line-height:1}.brand .slash{color:#254afb;margin-left:-5px}.ink .brand .slash{color:#caff9c}.eyebrow{font-size:20px;letter-spacing:2.5px;font-weight:700;text-transform:uppercase;line-height:1.35}.blue{color:#254afb}.mint{color:#caff9c}.muted{color:#63707c}.ink .muted{color:#b3bdc9}.display{font-family:'Arial Black',Arial,Helvetica,sans-serif;font-weight:900;letter-spacing:-6px;line-height:1.08;margin:0}.heading{font-size:72px;line-height:1.04;font-weight:800;letter-spacing:-3px;margin:0}.body{font-size:30px;line-height:1.4;margin:0}.small{font-size:22px;line-height:1.4;margin:0}.rule{height:2px;background:currentColor;opacity:.2}.pill{display:inline-block;background:#254afb;color:#fff;padding:11px 17px;font-size:20px;letter-spacing:1.4px;font-weight:700}.ink .pill{background:#caff9c;color:#111923}.bottom{position:absolute;left:60px;right:60px;bottom:48px}.footer{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #b7bab6;padding-top:22px;gap:20px}.ink .footer{border-color:#505b68}.caption{font-size:20px;line-height:1.4;letter-spacing:.1px}.proof{background:#0b1320;padding:10px;border:1px solid #56616c;box-shadow:14px 14px 0 #d6d9d2}.proof img{display:block;width:100%;height:auto}.ink .proof{box-shadow:14px 14px 0 #263549}.arrow{font-weight:400;font-family:Arial,Helvetica,sans-serif;letter-spacing:0}.number-row{display:flex;align-items:center;justify-content:space-between}.number{font-family:'Arial Black',Arial,sans-serif;font-weight:900;letter-spacing:-8px;line-height:1.08}.unit{font-weight:400;letter-spacing:0}.badge{border:1px solid currentColor;display:inline-block;padding:9px 13px;font-weight:700;font-size:21px;line-height:1}.slide-label{font-size:20px;font-weight:700;letter-spacing:2px}.section-title{font-size:24px;font-weight:700;letter-spacing:.5px}.graph-box{padding:30px;border:2px solid #89969b;background:#faf9f3}.graph-box strong{font-size:32px;line-height:1.25;display:block}.graph-box p{font-size:25px;line-height:1.4;margin:12px 0 0}.graph-blue{border-color:#254afb;background:#254afb;color:white}.graph-ink{background:#111923;color:#f2f0e7;border-color:#111923}.down{font-size:60px;font-family:Arial,sans-serif;text-align:center;line-height:1.15}.step{font-size:17px;font-weight:700;letter-spacing:2px;margin-bottom:14px}.repo{font-size:28px;font-weight:700;line-height:1.4;letter-spacing:-.5px}.scope{font-weight:700}.yt .brand{font-size:28px}.yt .display{font-size:182px}.yt .number-row{margin-top:65px}.yt .number{font-size:205px}.yt .num-label{font-size:27px;margin-top:12px;font-weight:700}.yt .unit{font-size:36px;margin-top:8px}.yt .arrow{font-size:106px}.yt .scope{margin-top:42px;font-size:39px;letter-spacing:-1px}.yt .bottom{bottom:43px}.yt .footer{padding-top:20px}.li{padding:48px}.li .brand{font-size:23px}.li .number-row{margin-top:50px;justify-content:start;gap:42px}.li .number{font-size:150px}.li .arrow{font-size:88px}.li .unit{font-size:35px;letter-spacing:-1px}.li .num-label{font-size:23px;font-weight:700;margin-top:16px}.li .scope{font-size:35px;letter-spacing:-.8px;margin-top:42px}.li .bottom{left:48px;right:48px;bottom:34px}.li .caption{font-size:20px}.square .number{font-size:182px}.square .arrow{font-size:92px}.square .scope{font-size:43px;line-height:1.14;letter-spacing:-1.5px}.square .unit{font-size:31px}.portrait .topline{display:flex;justify-content:space-between;align-items:center}.portrait .scope{font-size:31px;line-height:1.3;letter-spacing:-.8px}.portrait .bottom{bottom:48px}.portrait .caption{font-size:21px}.portrait .heading{font-size:77px}.portrait .proof{box-shadow:12px 12px 0 #d6d9d2}.small-rule{width:58px;height:7px;background:#254afb}.ink .small-rule{background:#caff9c}
`;
const brand = `<div class="brand" data-qa><span class="mark">D<span class="slash">/</span></span><span>Decisions Browser</span></div>`;
const numberPair = (units = 'seconds') => `<div class="number-row" data-qa><div><div class="number">160</div><div class="unit">${units}</div><div class="num-label">Windows Computer Use</div></div><div class="arrow">→</div><div class="blue"><div class="number">1.7</div><div class="unit">${units}</div><div class="num-label">Decisions Browser</div></div></div>`;
const slideTop = number => `<div class="topline">${brand}<span class="slide-label" data-qa>${number} / 04</span></div>`;
const footer = (left, right = 'Bill Moore') => `<div class="bottom"><div class="footer" data-qa><span class="caption">${left}</span><span class="caption">${right}</span></div></div>`;
const github = 'github.com/chickensintrees/decisions-browser';
const refinements = '.li .number-row{justify-content:space-between;gap:24px}';

const assets = [
  { name: '01-youtube-thumbnail', width: 1280, height: 720, className: 'ink yt', content: `${brand}<div class="number-row" data-qa><div><div class="number">160<span class="unit"> s</span></div><div class="num-label muted">Windows Computer Use</div></div><div class="arrow mint">→</div><div class="mint"><div class="number">1.7<span class="unit"> s</span></div><div class="num-label">Decisions Browser</div></div></div><p class="scope" data-qa>One recorded browser workflow.</p>${footer('<span class="pill">FREE + OPEN SOURCE</span>', 'Built by Bill Moore')}` },
  { name: '02-linkedin-landscape', width: 1200, height: 627, className: 'li', content: `${brand}<div class="eyebrow blue" style="position:absolute;right:48px;top:52px" data-qa>Harness engineering</div>${numberPair()}<div class="scope" data-qa>One recorded browser workflow.</div>${footer('<strong>Free + open source</strong><br>'+github, 'Built by Bill Moore')}` },
  { name: '03-square', width: 1080, height: 1080, className: 'square', content: `${brand}<div class="eyebrow blue" style="margin-top:70px" data-qa>A smaller control loop</div><div style="display:flex;gap:28px;align-items:baseline;margin-top:30px" data-qa><span class="number">160</span><span class="unit">seconds</span></div><div style="display:flex;gap:28px;align-items:baseline;margin-top:15px" data-qa><span class="arrow">→</span><span class="number blue">1.7</span><span class="unit blue">seconds</span></div><p class="scope" style="margin:52px 0 25px" data-qa>One recorded<br>browser workflow.</p><p class="small muted" data-qa>Same outcome. 11 verified checks.<br>Models not matched; control paths differ.</p>${footer('<strong>Free + open source</strong><br>'+github, 'Bill Moore')}` },
  { name: '04-carousel-01-hook', width: 1080, height: 1350, className: 'portrait ink', content: `${slideTop('01')}<div class="eyebrow mint" style="margin-top:83px" data-qa>The cost of the control loop</div><div class="display" style="font-size:215px;margin-top:46px" data-qa>160<span style="font-size:74px;letter-spacing:-2px"> s</span></div><div class="small muted" style="margin-top:22px" data-qa>Windows Computer Use · host agent</div><div class="arrow mint" style="font-size:104px;line-height:1;margin:25px 0" data-qa>↓</div><div class="display mint" style="font-size:215px" data-qa>1.7<span style="font-size:74px;letter-spacing:-2px"> s</span></div><div class="small mint" style="margin-top:22px" data-qa>Decisions Browser · DOM + fast model</div><div class="scope" style="font-size:47px;margin-top:75px;line-height:1.15" data-qa>One recorded<br>browser workflow.</div>${footer('Same outcome. 11 checks. Actual inputs.', 'Bill Moore')}` },
  { name: '05-carousel-02-proof', width: 1080, height: 1350, className: 'portrait', content: `${slideTop('02')}<h1 class="heading" style="margin-top:70px" data-qa>Watch the run.<br>Check the result.</h1><p class="body" style="margin-top:25px" data-qa>Search. Set filters. Open the right record.</p><div class="proof" style="margin-top:44px" data-qa><img src="assets/demo-both-finished.png" alt="Actual comparison video frame showing both tools at their verified finish"></div><div style="display:flex;gap:18px;margin-top:43px" data-qa><span class="badge blue">11 / 11 checks</span><span class="badge">Original-speed capture</span></div><p class="scope" style="margin-top:34px" data-qa>One recorded browser workflow.</p><p class="small muted" style="margin-top:18px" data-qa>One local catalog task. Models not matched; control paths differ.<br>Windows run included input recovery. Setup excluded.</p>${footer('Real demo frame · no simulated UI', 'Bill Moore')}` },
  { name: '06-carousel-03-harness', width: 1080, height: 1350, className: 'portrait', content: `${slideTop('03')}<h1 class="heading" style="margin-top:70px" data-qa>Move the loop<br>into the tool.</h1><p class="body" style="margin-top:28px" data-qa>One MCP call owns a bounded workflow.</p><div style="margin-top:48px" data-qa><div class="graph-box"><div class="step muted">01 / THE CALLER</div><strong>Goal + allowed text + completion checks</strong></div><div class="down blue">↓</div><div class="graph-box graph-blue"><div class="step">02 / THE LOCAL HARNESS</div><strong>Observe → choose → act</strong><p>Finite action choices. A fast decision model.<br>Step limits, time limits and origin rules.</p></div><div class="down blue">↓</div><div class="graph-box graph-ink"><div class="step" style="color:#caff9c">03 / THE PROOF</div><strong>Verify the actual browser state.</strong><p>DOM + URL assertions decide completion.</p></div></div><p class="small muted" style="margin-top:34px" data-qa>The recorded result is a case study in harness design.<br>It is not a universal model benchmark.</p>${footer('One recorded browser workflow', 'Bill Moore')}` },
  { name: '07-carousel-04-cta', width: 1080, height: 1350, className: 'portrait ink', content: `${slideTop('04')}<div class="eyebrow mint" style="margin-top:95px" data-qa>Free + open source</div><h1 class="heading" style="font-size:105px;margin-top:38px;line-height:1.01" data-qa>Build a<br>smaller loop.</h1><p class="body" style="font-size:38px;margin-top:47px;max-width:850px" data-qa>Fork Decisions Browser.<br>Run the demo. Inspect the traces.</p><div class="rule" style="margin-top:65px" data-qa></div><div class="repo mint" style="margin-top:39px;font-size:33px" data-qa>github.com/chickensintrees/<br>decisions-browser</div><p class="body" style="margin-top:70px;font-size:34px" data-qa>Need a workflow like this?</p><p class="body" style="font-size:39px;font-weight:700;margin-top:13px" data-qa>Work with Bill Moore.</p><p class="small muted" style="margin-top:16px" data-qa>AI systems + agent harness engineering</p>${footer('Demo result: one recorded browser workflow', 'Bill Moore')}` }
];

const browser = await launchBrowser({ headless: true });
const checks = [];
try {
  for (const asset of assets) {
    const htmlName = asset.name + '.html';
    let content = asset.content;
    if (asset.name === '01-youtube-thumbnail') content = content.replace('</p>', '</p><p class="small muted" style="margin-top:18px" data-qa>Models not matched; control paths differ. Windows run included input recovery.</p>');
    if (asset.name === '02-linkedin-landscape') content = content.replace('One recorded browser workflow.</div>', 'One recorded browser workflow.</div><p class="caption muted" style="font-size:17px;margin-top:10px" data-qa>One local task · models not matched; control paths differ · Windows input recovery · setup excluded.</p>');
    if (asset.name === '03-square') content = content.replace('Models not matched; control paths differ.</p>', 'Models not matched; control paths differ.<br>Windows run included input recovery.<br>Setup excluded.</p>');
    if (asset.name === '04-carousel-01-hook') content = content.replace('browser workflow.</div>', 'browser workflow.</div><p class="small muted" style="margin-top:24px" data-qa>Models not matched; control paths differ · setup excluded</p>');
    const document = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${asset.name}</title><style>${styles}${refinements}</style></head><body><main class="art ${asset.className}" style="--w:${asset.width}px;--h:${asset.height}px">${content}</main></body></html>`;
    await writeFile(join(output, htmlName), document);
    const context = await browser.newContext({ viewport: { width: asset.width, height: asset.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(pathToFileURL(join(output, htmlName)).href);
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const art = document.querySelector('.art').getBoundingClientRect();
      return [...document.querySelectorAll('[data-qa]')].map(element => {
        const box = element.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        const content = range.getBoundingClientRect();
        const style = getComputedStyle(element);
        const clipped = ['hidden', 'clip'].includes(style.overflowX) || ['hidden', 'clip'].includes(style.overflowY);
        return { text: element.textContent.trim().slice(0, 90), left: box.left, top: box.top, right: box.right, bottom: box.bottom, safe: box.left >= 24 && box.top >= 24 && box.right <= art.right - 24 && box.bottom <= art.bottom - 24 && (!range.getClientRects().length || (content.left >= 24 && content.top >= 24 && content.right <= art.right - 24 && content.bottom <= art.bottom - 24)), overflow: clipped && (element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2) };
      });
    });
    assert.ok(layout.every(item => item.safe && !item.overflow), asset.name + ': ' + JSON.stringify(layout.filter(item => !item.safe || item.overflow)));
    const path = join(renderDirectory, asset.name + '.png');
    await page.screenshot({ path });
    const png = await readFile(path);
    assert.equal(png.readUInt32BE(16), asset.width);
    assert.equal(png.readUInt32BE(20), asset.height);
    checks.push({ file: asset.name + '.png', source: htmlName, width: asset.width, height: asset.height, bytes: png.length, layoutChecks: layout.length, noClipping: true, sha256: createHash('sha256').update(png).digest('hex') });
    await context.close();
  }
} finally { await browser.close(); }

const proofCopiesVerified = (await Promise.all([['fast-finished.png', 'demo-fast-finished.png'], ['both-finished.png', 'demo-both-finished.png']].map(async ([source, copy]) => (await readFile(join(root, 'artifacts', 'demo', '2026-10-15', source))).equals(await readFile(join(output, 'assets', copy)))))).every(Boolean);
assert.ok(proofCopiesVerified, 'Proof images must remain unchanged copies of the source captures.');
await writeFile(join(renderDirectory, 'render-checks.json'), JSON.stringify({ iteration, assets: checks, scope: 'One recorded browser workflow. Models not matched; control paths differ. Windows run included input recovery. Setup excluded.', proofSources: ['assets/demo-fast-finished.png', 'assets/demo-both-finished.png'], proofCopiesVerified }, null, 2));
const gallery = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Decisions Browser campaign</title><style>body{margin:0;padding:40px;background:#e2e2db;color:#141b25;font:18px Arial,sans-serif}h1{margin:0 0 12px}p{margin:0 0 30px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:28px}.card{background:white;padding:14px;align-self:start}.card img{display:block;width:100%;height:auto}.card a{color:inherit;text-decoration:none}.card span{display:block;margin:14px 0 0;font-size:15px}</style></head><body><h1>Decisions Browser / campaign creative</h1><p>One recorded browser workflow. Code-native design. Actual demonstration frames.</p><div class="grid">${checks.map(asset => `<div class="card"><a href="${asset.file}"><img src="${asset.file}" alt="${asset.file}"><span>${asset.file} · ${asset.width} × ${asset.height}</span></a></div>`).join('')}</div></body></html>`;
await writeFile(join(renderDirectory, 'index.html'), gallery);
console.log(JSON.stringify({ directory: iteration === 'final' ? 'campaign/creative' : 'artifacts/campaign/creative-review/' + iteration, assets: checks.length, checks: 'PNG dimensions and every marked content box passed.' }));
