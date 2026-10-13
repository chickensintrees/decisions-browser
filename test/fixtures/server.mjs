import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const style = `body{font:16px/1.5 system-ui,sans-serif;max-width:1080px;margin:30px auto;padding:0 24px;color:#21352b;background:#eef3ef}h1{font-size:30px}form,article,section,table{background:white;border:1px solid #b9cebf;border-radius:8px;padding:18px}form{display:flex;gap:18px;align-items:end;flex-wrap:wrap}label{display:block;font-weight:600}input,select,button{font:inherit;padding:8px}input[type=checkbox],input[type=radio]{accent-color:#24654c}button,a{cursor:pointer}button{background:#24654c;color:white;border:0;border-radius:5px}article{margin-top:12px}dl{display:grid;grid-template-columns:170px 1fr;gap:8px}dd{margin:0}td,th{padding:10px;text-align:left}[hidden]{display:none!important}`;
const html = (title, content, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${style}</style></head><body><nav><a href="/catalog">Stay catalog</a> | <a href="/queue">Support queue</a></nav><main><h1>${title}</h1>${content}</main><script>${script}</script></body></html>`;
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function catalogPage() {
  return html('Stay catalog', `<p>Search the public inventory. Similar names may have different policies.</p>
    <form id="catalog-search">
      <div><label for="query">Search inventory</label><input id="query" name="query" type="search"></div>
      <div><label for="city">City</label><select id="city" name="city"><option>Lisbon</option><option>Porto</option><option selected>Madrid</option></select></div>
      <fieldset><legend>Style</legend><label><input type="radio" name="style" value="Design">Design</label><label><input type="radio" name="style" value="Classic" checked>Classic</label></fieldset>
      <label><input id="free-cancellation" type="checkbox" name="freeCancellation">Free cancellation</label>
      <button type="submit">Search catalog</button>
    </form>
    <p id="search-summary" role="status">Set a query and filters to search.</p><section id="catalog-results" aria-label="Catalog results" hidden></section>`, `
    const form=document.querySelector('#catalog-search'); const results=document.querySelector('#catalog-results'); const summary=document.querySelector('#search-summary'); let version=0;
    const params=()=>{const data=new URLSearchParams(new FormData(form));data.set('freeCancellation',String(form.elements.freeCancellation.checked));return data;};
    form.addEventListener('change',()=>{version++;results.hidden=true;results.replaceChildren();summary.textContent='Filters changed. Search again.';results.removeAttribute('aria-busy');});
    form.addEventListener('submit',async event=>{event.preventDefault();const request=++version;const filters=params();results.hidden=false;results.setAttribute('aria-busy','true');results.textContent='Loading inventory...';summary.textContent='Searching catalog...';const data=await fetch('/catalog/search?'+filters).then(r=>r.json());if(request!==version)return;results.replaceChildren();for(const record of data.records){const article=document.createElement('article');article.innerHTML='<h2>'+record.name+'</h2><p>'+record.city+' | '+record.style+' | '+(record.freeCancellation?'Free cancellation':'Non-refundable')+'</p>';const link=document.createElement('a');link.href='/catalog/record/'+record.id+'?'+filters;link.textContent='Open '+record.name;article.append(link);results.append(article);}results.removeAttribute('aria-busy');summary.textContent='Search complete: '+data.records.length+' stays for '+filters.get('query')+'.';});`);
}

function catalogDetail(url) {
  const records = {
    'casa-flora': { name: 'Casa Flora', city: 'Lisbon', style: 'Design', freeCancellation: true },
    'casa-flora-porto': { name: 'Casa Flora Porto', city: 'Porto', style: 'Design', freeCancellation: true },
    'casa-flora-annex': { name: 'Casa Flora Annex', city: 'Lisbon', style: 'Design', freeCancellation: false }
  };
  const record = records[url.pathname.split('/').at(-1)];
  if (!record) return null;
  return html('Stay details', `<section aria-label="Stay detail"><h2 id="detail-name">${record.name}</h2><dl>
    <dt>City</dt><dd id="detail-city">${record.city}</dd><dt>Style</dt><dd id="detail-style">${record.style}</dd>
    <dt>Policy</dt><dd id="detail-policy">${record.freeCancellation ? 'Free cancellation' : 'Non-refundable'}</dd>
    <dt>Inventory</dt><dd id="detail-inventory">Available</dd></dl></section>
    <section aria-label="Applied search"><h2>Applied search</h2><label for="detail-query">Search query</label><input id="detail-query" readonly value="${escape(url.searchParams.get('query') ?? '')}">
    <p id="detail-filter-city">${escape(url.searchParams.get('city') ?? '')}</p><p id="detail-filter-style">${escape(url.searchParams.get('style') ?? '')}</p>
    <label><input id="detail-free" type="checkbox" disabled ${url.searchParams.get('freeCancellation') === 'true' ? 'checked' : ''}>Free cancellation selected</label></section>`);
}

function queuePage() {
  return html('Support queue', `<p>Find an existing ticket. This demo has no edit or assignment actions.</p><form id="queue-search">
    <div><label for="ticket-query">Ticket query</label><input id="ticket-query" name="query" type="search"></div>
    <div><label for="status">Status</label><select id="status" name="status"><option selected>All</option><option>Open</option><option>Closed</option></select></div>
    <label><input id="only-unassigned" name="unassigned" type="checkbox">Only unassigned</label>
    <button type="submit">Search queue</button></form><p id="queue-summary" role="status">Choose filters and search.</p><table id="queue-results" aria-label="Queue results" hidden><thead><tr><th>Ticket</th><th>Subject</th><th>Status</th><th>Owner</th><th>View</th></tr></thead><tbody></tbody></table>`, `
    const form=document.querySelector('#queue-search'),table=document.querySelector('#queue-results'),body=table.querySelector('tbody'),summary=document.querySelector('#queue-summary');let version=0;
    form.addEventListener('change',()=>{version++;table.hidden=true;body.replaceChildren();table.removeAttribute('aria-busy');summary.textContent='Filters changed. Search again.';});
    form.addEventListener('submit',async event=>{event.preventDefault();const current=++version,data=new URLSearchParams(new FormData(form));data.set('unassigned',String(form.elements.unassigned.checked));table.hidden=false;table.setAttribute('aria-busy','true');summary.textContent='Loading tickets...';const rows=await fetch('/queue/search?'+data).then(r=>r.json());if(current!==version)return;body.replaceChildren();for(const row of rows){const tr=document.createElement('tr');tr.innerHTML='<td>'+row.id+'</td><td>'+row.subject+'</td><td>'+row.status+'</td><td>'+row.owner+'</td>';const td=document.createElement('td'),a=document.createElement('a');a.href='/queue/ticket/'+row.id+'?'+data;a.textContent='Open ticket '+row.id;td.append(a);tr.append(td);body.append(tr);}table.removeAttribute('aria-busy');summary.textContent='Search complete: '+rows.length+' tickets.';});`);
}

function queueDetail(url) {
  const rows = {
    '417': { subject: 'Entrance door maintenance', status: 'Open', owner: 'Unassigned' },
    '471': { subject: 'Entrance door maintenance archive', status: 'Closed', owner: 'Sam' }
  };
  const id = url.pathname.split('/').at(-1);
  const row = rows[id];
  if (!row) return null;
  return html('Ticket details', `<section aria-label="Ticket detail"><h2 id="ticket-id">Ticket ${id}</h2><dl><dt>Subject</dt><dd id="ticket-subject">${row.subject}</dd><dt>Status</dt><dd id="ticket-status">${row.status}</dd><dt>Owner</dt><dd id="ticket-owner">${row.owner}</dd></dl><p id="ticket-query">Query: ${escape(url.searchParams.get('query') ?? '')}</p></section>`);
}

export async function startFixtures({ port = 0 } = {}) {
  const requests = [];
  const foreignRequests = [];
  const foreign = createServer((request, response) => {
    foreignRequests.push(request.url);
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }).end('External destination reached');
  });
  await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
  const foreignOrigin = `http://127.0.0.1:${foreign.address().port}`;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://fixture.invalid');
    requests.push(url.pathname + url.search);
    const send = content => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(content);
    if (url.pathname === '/catalog') return send(catalogPage());
    if (url.pathname.startsWith('/catalog/record/')) {
      const content = catalogDetail(url);
      if (content) return send(content);
    }
    if (url.pathname === '/catalog/search') {
      await new Promise(resolve => setTimeout(resolve, 120));
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ records: [
        { id: 'casa-flora-porto', name: 'Casa Flora Porto', city: 'Porto', style: 'Design', freeCancellation: true },
        { id: 'casa-flora-annex', name: 'Casa Flora Annex', city: 'Lisbon', style: 'Design', freeCancellation: false },
        { id: 'casa-flora', name: 'Casa Flora', city: 'Lisbon', style: 'Design', freeCancellation: true }
      ] }));
      return;
    }
    if (url.pathname === '/queue') return send(queuePage());
    if (url.pathname.startsWith('/queue/ticket/')) {
      const content = queueDetail(url);
      if (content) return send(content);
    }
    if (url.pathname === '/queue/search') {
      await new Promise(resolve => setTimeout(resolve, 120));
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify([
        { id: 471, subject: 'Entrance door maintenance archive', status: 'Closed', owner: 'Sam' },
        { id: 417, subject: 'Entrance door maintenance', status: 'Open', owner: 'Unassigned' }
      ]));
      return;
    }
    if (url.pathname === '/password') return send(html('Public lookup', `<section><p id="public-note">Public information only</p><label for="password">Password</label><input id="password" type="password" value=""><label for="public-query">Public query</label><input id="public-query" type="text"></section>`));
    if (url.pathname === '/stale') return send(html('Record viewer', `<button id="record-control" data-operation="open">Open record</button><p id="operation-result">Waiting</p>`, `document.querySelector('#record-control').addEventListener('click',event=>{const operation=event.currentTarget.dataset.operation;document.querySelector('#operation-result').textContent=operation==='open'?'Opened record':'Deleted record';fetch('/event?operation='+operation);});`));
    if (url.pathname === '/event') { response.writeHead(204).end(); return; }
    if (url.pathname === '/outside-link') return send(html('External reference', `<a id="external-link" href="${foreignOrigin}/destination">External destination</a><p id="origin-note">Original origin</p>`));
    if (url.pathname === '/outside-navigation') return send(html('Navigation boundary', `<button id="external-navigation">Open external page</button><p id="origin-note">Original origin</p>`, `document.querySelector('#external-navigation').addEventListener('click',()=>location.href=${JSON.stringify(foreignOrigin + '/navigation')});`));
    if (url.pathname === '/outside-request') return send(html('Request boundary', `<p id="origin-note">Original origin</p><button id="external-request">Load external reference</button><p id="request-status">Not requested</p>`, `document.querySelector('#external-request').addEventListener('click',async()=>{try{await fetch(${JSON.stringify(foreignOrigin + '/reference')});document.querySelector('#request-status').textContent='Request allowed';}catch{document.querySelector('#request-status').textContent='Request blocked';}});`));
    response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Unknown fixture route');
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, foreignOrigin, requests, foreignRequests,
    close: () => Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => foreign.close(resolve))])
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const index = process.argv.indexOf('--port');
  const fixture = await startFixtures({ port: index < 0 ? 4173 : Number(process.argv[index + 1]) });
  console.log(JSON.stringify({ catalog: fixture.origin + '/catalog', queue: fixture.origin + '/queue' }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await fixture.close(); process.exit(0); });
}
