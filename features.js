/* Value HTML: features layered on the core app (app code is inline in index.html).
   Loaded first; everything here runs lazily, so it can use the app's globals (S, G, $, esc, ...)
   at call time. Ideas are inspired by LLM-wiki style knowledge bases (community detection,
   graph insights, relevance-ranked retrieval, citations); the code is independent. */
'use strict';
const isNative = () => typeof hvNative !== 'undefined';
const FX = { cache: { ver: -1 }, chat: { msgs: [], busy: false, id: null }, qs: { items: [], idx: 0 }, uiBuilt: false };

/* ------------------------------------------------------------ analysis data */
function analysisData() {
  if (FX.cache.ver === S.ver && FX.cache.backend === S.backend) return FX.cache;
  const notes = [...S.notes.values()];
  const nodes = notes.map(n => ({ id: n.path, label: n.name, tags: n.allTags, type: n.dir.split('/')[0] || '' }));
  const edges = [], seen = new Set();
  for (const n of notes) for (const l of n.links) {
    const t = S.byName.get(lc(l));
    if (t && t !== n) {
      const k = n.path < t.path ? n.path + '\n' + t.path : t.path + '\n' + n.path;
      if (!seen.has(k)) { seen.add(k); edges.push({ a: n.path, b: t.path }); }
    }
  }
  FX.cache = {
    ver: S.ver, backend: S.backend, notes, nodes, edges, ctx: HVA.buildContext(nodes, edges),
    docs: notes.map(n => ({ id: n.path, title: n.name, plain: n.plain || '', tags: n.allTags })),
  };
  return FX.cache;
}

/* ------------------------------------------------------------ related notes */
function relatedHtml(n) {
  if (!S.notes.size) return '';
  const d = analysisData();
  const rel = HVA.related(n.path, d.ctx, 6).filter(r => S.notes.has(r.id));
  if (!rel.length) return '';
  return '<h4>Related notes</h4>' + rel.map(r => {
    const x = S.notes.get(r.id), s = r.signals;
    const why = [s.direct ? 'linked' : '', s.sharedTags ? `${s.sharedTags} shared tag${s.sharedTags > 1 ? 's' : ''}` : '',
      !s.direct && s.adamicAdar ? 'common neighbours' : ''].filter(Boolean).join(' · ');
    return `<span class="lnk" data-open="${esc(x.path)}" title="${esc(why)}">${esc(x.name)} <span class="meta">${r.score.toFixed(1)}</span></span>`;
  }).join('');
}

/* ----------------------------------------------------------------- insights */
function buildInsightsSection() {
  const d = document.createElement('details');
  d.innerHTML = '<summary>Insights</summary><div class="gname">Surprising links, gaps and bridge notes found from the link structure. Click a card to highlight it in the graph.</div><button class="ins-run" style="margin:6px 0">Analyze vault</button><div class="ins-out"></div>';
  const out = $('.ins-out', d);
  const run = () => renderInsights(out);
  $('.ins-run', d).onclick = run;
  d.addEventListener('toggle', () => { if (d.open) run(); });
  out.addEventListener('click', e => {
    const o = e.target.closest('[data-open]');
    if (o) { openNote(o.dataset.open); return; }
    const a = e.target.closest('[data-ask]');
    if (a) { openChat(a.dataset.ask); return; }
    const c = e.target.closest('[data-hl]');
    if (c) {
      const key = c.dataset.hl, same = G.hl && G.hlKey === key;
      setHighlight(same ? null : key.split('|'), key);
      if (S.view === 'note') setView('split');
    }
  });
  return d;
}
function renderInsights(out) {
  const d = analysisData();
  if (d.nodes.length < 2) { out.innerHTML = '<div class="gname">Add a few linked notes first.</div>'; return; }
  const ids = d.nodes.map(n => n.id);
  const comm = HVA.louvain(ids, d.edges), coh = HVA.cohesion(comm, d.edges);
  const ins = HVA.insights(d.nodes, d.edges, comm, coh);
  const nm = id => S.notes.get(id)?.name || id;
  const link = id => `<span class="lnk" data-open="${esc(id)}">${esc(nm(id))}</span>`;
  const nbrs = id => d.edges.filter(e => e.a === id || e.b === id).map(e => e.a === id ? e.b : e.a);
  const ask = (txt) => `<button class="mini" data-ask="${esc(txt)}" title="Ask the AI about this">💬</button>`;
  let h = '';
  h += `<div class="ins-h">Surprising connections</div>` + (ins.surprising.length ? ins.surprising.map(s =>
    `<div class="card" data-hl="${esc(s.a + '|' + s.b)}">${link(s.a)} ↔ ${link(s.b)}<div class="gname">${esc(s.reasons.join('; '))}</div></div>`).join('') : '<div class="gname">None found.</div>');
  h += `<div class="ins-h">Isolated notes (${ins.isolated.length})</div>` + (ins.isolated.length ?
    `<div class="card">${ins.isolated.slice(0, 15).map(x => link(x.id)).join('')}${ins.isolated.length > 15 ? `<div class="gname">+${ins.isolated.length - 15} more</div>` : ''}${ask('Which of my notes are isolated, and how could I connect them to the rest? Suggest links: ' + ins.isolated.slice(0, 8).map(x => nm(x.id)).join(', '))}</div>` : '<div class="gname">Everything is connected.</div>');
  h += `<div class="ins-h">Sparse clusters</div>` + (ins.sparse.length ? ins.sparse.map(s => {
    const mem = ids.filter(id => comm.get(id) === s.community);
    return `<div class="card" data-hl="${esc(mem.join('|'))}"><b>${s.size} notes</b>, cohesion ${(s.cohesion * 100).toFixed(0)}%<div class="gname">${esc(mem.slice(0, 4).map(nm).join(', '))}${mem.length > 4 ? '…' : ''}</div>${ask('These notes are weakly connected to each other: ' + mem.slice(0, 8).map(nm).join(', ') + '. What links or missing topics would tie them together?')}</div>`;
  }).join('') : '<div class="gname">No weak clusters.</div>');
  h += `<div class="ins-h">Bridge notes</div>` + (ins.bridges.length ? ins.bridges.map(b =>
    `<div class="card" data-hl="${esc([b.id, ...nbrs(b.id)].join('|'))}">${link(b.id)}<div class="gname">connects ${b.clusters} clusters</div></div>`).join('') : '<div class="gname">None found.</div>');
  out.innerHTML = h;
}

/* ------------------------------------------------------------------- search */
function buildUI() {
  if (FX.uiBuilt) return;
  FX.uiBuilt = true;
  document.body.insertAdjacentHTML('beforeend', `
  <div id="qs" hidden><div class="qs-box">
    <input id="qsInput" type="search" placeholder="Search notes…  also tag:#x  path:folder  file:name" autocomplete="off">
    <div id="qsResults"></div>
    <div class="qs-foot">↑↓ to move · Enter to open · Esc to close</div>
  </div></div>
  <aside id="chat" hidden>
    <div class="chat-head"><b>Ask your notes</b><span class="spacer"></span><button id="chatNew" title="New chat">New</button><button id="chatClose" title="Close">✕</button></div>
    <div id="chatLog"></div>
    <div class="chat-foot">
      <textarea id="chatInput" rows="2" placeholder="Ask about your notes…  (Enter to send, Shift+Enter for a new line)"></textarea>
      <button id="chatSend" class="primary">Send</button>
    </div>
  </aside>
  <div id="settings" hidden><div class="set-box">
    <div class="set-head"><h3>Settings</h3><span class="spacer"></span><button id="setClose">✕</button></div>
    <div id="setBody"></div>
  </div></div>`);
  // search
  const qi = $('#qsInput');
  qi.addEventListener('input', debounce(runSearch, 80));
  qi.addEventListener('keydown', e => {
    const n = FX.qs.items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); FX.qs.idx = Math.min(n - 1, FX.qs.idx + 1); paintSearch(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); FX.qs.idx = Math.max(0, FX.qs.idx - 1); paintSearch(); }
    else if (e.key === 'Enter') { e.preventDefault(); pickSearch(FX.qs.idx); }
    else if (e.key === 'Escape') closeSearch();
  });
  $('#qs').addEventListener('mousedown', e => { if (e.target.id === 'qs') closeSearch(); });
  $('#qsResults').addEventListener('click', e => { const i = e.target.closest('.qs-item'); if (i) pickSearch(+i.dataset.i); });
  // chat
  $('#chatClose').onclick = closeChat;
  $('#chatNew').onclick = () => { stopChat(); FX.chat.msgs = []; renderChat(); };
  $('#chatSend').onclick = () => (FX.chat.busy ? stopChat() : sendChat());
  $('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
  $('#chatLog').addEventListener('click', e => {
    const o = e.target.closest('[data-open]'), l = e.target.closest('a[data-link]'), sv = e.target.closest('[data-save]');
    if (o) { e.preventDefault(); openNote(o.dataset.open); }
    else if (l) { e.preventDefault(); const t = S.byName.get(lc(l.dataset.link)); if (t) openNote(t.path); }
    else if (sv) saveAnswer(+sv.dataset.save);
  });
  // settings
  $('#setClose').onclick = closeSettings;
  $('#settings').addEventListener('mousedown', e => { if (e.target.id === 'settings') closeSettings(); });
  if (isNative()) hvNative.llm.onEvent(onLlmEvent);
}

function openSearch(initial = '') {
  buildUI();
  $('#qs').hidden = false;
  const i = $('#qsInput'); i.value = initial; i.focus(); i.select();
  runSearch();
}
function closeSearch() { $('#qs').hidden = true; }
function runSearch() {
  const q = $('#qsInput').value.trim();
  const d = analysisData();
  let items;
  if (!q) items = d.notes.slice().sort((a, b) => (b.updated || '').localeCompare(a.updated || '')).slice(0, 12)
    .map(n => ({ path: n.path, title: n.name, snippet: n.plain.slice(0, 120) }));
  else if (/(^|\s)(tag:|path:|file:|#)/.test(q)) items = d.notes.filter(n => matches(n, q)).slice(0, 40)
    .map(n => ({ path: n.path, title: n.name, snippet: n.plain.slice(0, 120) }));
  else items = HVA.search(d.docs, q, { limit: 40 }).map(r => ({ path: r.id, title: S.notes.get(r.id).name, snippet: r.snippet }));
  FX.qs = { items, idx: 0, q };
  paintSearch();
}
function paintSearch() {
  const box = $('#qsResults');
  if (!FX.qs.items.length) { box.innerHTML = '<div class="qs-empty">No matching notes</div>'; return; }
  const terms = HVA.tokenize(FX.qs.q || '');
  const mark = s => {
    let t = esc(s);
    for (const w of terms) if (w.length > 1) t = t.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>');
    return t;
  };
  box.innerHTML = FX.qs.items.map((it, i) => {
    const n = S.notes.get(it.path), c = n && colorOf(n);
    return `<div class="qs-item${i === FX.qs.idx ? ' sel' : ''}" data-i="${i}"><div><span class="dot" style="${c ? 'background:' + c : ''}"></span> ${mark(it.title)} <span class="meta">${esc(it.path)}</span></div><div class="qs-snip">${mark(it.snippet || '')}</div></div>`;
  }).join('');
  $('.qs-item.sel', box)?.scrollIntoView({ block: 'nearest' });
}
function pickSearch(i) {
  const it = FX.qs.items[i]; if (!it) return;
  closeSearch(); openNote(it.path);
}

/* -------------------------------------------------------------------- chat */
function openChat(prefill) {
  buildUI();
  $('#chat').hidden = false;
  renderChat();
  const ta = $('#chatInput');
  if (prefill) ta.value = prefill;
  ta.focus();
}
function closeChat() { $('#chat').hidden = true; }
function stopChat() {
  const c = FX.chat;
  if (c.busy && isNative()) hvNative.llm.cancel(c.id);
  c.busy = false; $('#chatSend').textContent = 'Send';
  const last = c.msgs[c.msgs.length - 1]; if (last?.pending) last.pending = false;
  renderChat();
}
/** Pick context notes: keyword/tag search first, then pull in related notes via the link graph. */
function retrieve(query, budget) {
  const d = analysisData();
  const hits = HVA.search(d.docs, query, { limit: 6 });
  const picked = new Map(hits.map(h => [h.id, h.score]));
  for (const h of hits.slice(0, 3)) for (const r of HVA.related(h.id, d.ctx, 3)) if (!picked.has(r.id) && picked.size < 9) picked.set(r.id, r.score * 0.5);
  if (S.active && !picked.has(S.active) && /\b(this|current|here)\b/i.test(query)) picked.set(S.active, 99);
  const ids = [...picked].sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0]).filter(id => S.notes.has(id));
  const per = clamp(Math.floor(budget / Math.max(ids.length, 1)), 400, 4000);
  return ids.map(id => { const n = S.notes.get(id); return { path: id, name: n.name, tags: n.allTags, text: n.plain.slice(0, per) }; });
}
async function sendChat() {
  const c = FX.chat, ta = $('#chatInput'), q = ta.value.trim();
  if (!q || c.busy) return;
  if (!isNative()) { c.msgs.push({ role: 'assistant', content: 'AI chat is only available in the desktop app.', done: true }); renderChat(); return; }
  const st = await hvNative.settings.get();
  if (!st.llm.baseUrl || !st.llm.model) { toast('Set up an AI endpoint first'); openSettings(); return; }
  ta.value = '';
  const notes = retrieve(q, st.llm.contextChars || 12000);
  const history = c.msgs.filter(m => m.done && !m.error).slice(-6).map(m => ({ role: m.role, content: m.content }));
  c.msgs.push({ role: 'user', content: q, done: true });
  const asst = { role: 'assistant', content: '', cites: notes.map(n => n.path), pending: true };
  c.msgs.push(asst);
  const block = notes.map((n, i) => `[${i + 1}] ${n.name}${n.tags.length ? ' (' + n.tags.map(t => '#' + t).join(' ') + ')' : ''}\n${n.text}`).join('\n\n');
  const messages = [
    { role: 'system', content: 'You answer questions using the user\'s personal notes, which are numbered like [1], [2]. Base your answer on those notes, cite the ones you use inline as [n], and say clearly when the notes do not contain the answer. Reply in the same language as the question. Use Markdown.' },
    ...history,
    { role: 'user', content: (notes.length ? `Notes:\n\n${block}\n\n` : 'No notes matched this question.\n\n') + `Question: ${q}` },
  ];
  c.busy = true; c.id = crypto.randomUUID(); c.cur = asst;
  $('#chatSend').textContent = 'Stop';
  renderChat();
  hvNative.llm.start(c.id, messages);
}
function onLlmEvent(ev) {
  const c = FX.chat;
  if (ev.id !== c.id || !c.cur) return;
  const a = c.cur;
  if (ev.type === 'delta') a.content += ev.delta;
  else if (ev.type === 'error') { a.error = ev.error; a.pending = false; a.done = true; c.busy = false; $('#chatSend').textContent = 'Send'; }
  else if (ev.type === 'done') { a.pending = false; a.done = true; c.busy = false; $('#chatSend').textContent = 'Send'; }
  if (!FX.chatRaf) FX.chatRaf = requestAnimationFrame(() => { FX.chatRaf = 0; renderChat(); });
}
function answerHtml(a, { forNote = false } = {}) {
  let t = a.content, think = '';
  t = t.replace(/<think>([\s\S]*?)(<\/think>|$)/g, (m, x) => { think += x; return ''; });
  const doc = new DOMParser().parseFromString('<div>' + HVMD.toHtml(t) + '</div>', 'text/html');
  sanitizeTree(doc.body, { keepStyle: false });
  const w = document.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT), texts = [];
  while (w.nextNode()) texts.push(w.currentNode);
  for (const tn of texts) {
    if (tn.parentElement.closest('a,code,pre') || !/\[\d{1,2}\]/.test(tn.data)) continue;
    const frag = document.createDocumentFragment(); let last = 0;
    for (const m of tn.data.matchAll(/\[(\d{1,2})\]/g)) {
      frag.append(tn.data.slice(last, m.index));
      const path = a.cites?.[+m[1] - 1], note = path && S.notes.get(path);
      if (note) {
        const el = document.createElement('a'); el.textContent = m[0]; el.title = note.name;
        if (forNote) { el.className = 'wikilink'; el.dataset.link = note.name; el.setAttribute('href', ''); }
        else { el.className = 'cite'; el.dataset.open = path; el.href = '#'; }
        frag.append(el);
      } else frag.append(m[0]);
      last = m.index + m[0].length;
    }
    frag.append(tn.data.slice(last)); tn.replaceWith(frag);
  }
  const thinkHtml = think.trim() && !forNote ? `<details class="think"><summary>Thinking</summary><pre>${esc(think.trim())}</pre></details>` : '';
  return thinkHtml + doc.body.innerHTML;
}
function renderChat() {
  const log = $('#chatLog'); if (!log) return;
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  if (!FX.chat.msgs.length) {
    log.innerHTML = `<div class="chat-empty"><p>Ask anything about your notes. Answers cite the notes they use as <span class="cite">[1]</span>, <span class="cite">[2]</span>…</p>
      <p class="meta">Retrieval uses search, tags and the link graph. ${isNative() ? 'Configure your model under ⚙ Settings.' : 'Chat needs the desktop app.'}</p></div>`;
    return;
  }
  log.innerHTML = FX.chat.msgs.map((m, i) => {
    if (m.role === 'user') return `<div class="msg user">${esc(m.content)}</div>`;
    const body = m.error ? `<div class="err">${esc(m.error)}</div>` : '';
    const src = m.cites?.length && !m.pending ? `<div class="srcs">Sources: ${m.cites.map((p, k) => `<a class="cite" data-open="${esc(p)}" href="#">[${k + 1}] ${esc(S.notes.get(p)?.name || '?')}</a>`).join(' ')}</div>` : '';
    const save = m.done && !m.error && m.content ? `<button class="mini" data-save="${i}">Save as note</button>` : '';
    return `<div class="msg ai">${answerHtml(m)}${m.pending && !m.content ? '<span class="dots">…</span>' : ''}${body}${src}${save}</div>`;
  }).join('');
  if (stick) log.scrollTop = log.scrollHeight;
}
async function saveAnswer(i) {
  const a = FX.chat.msgs[i], q = FX.chat.msgs[i - 1]?.content || 'Answer';
  const title = sanitizeName(q.replace(/[?!.]+$/, '').slice(0, 60)) || 'Answer';
  const name = uniqueName(title);
  const srcs = (a.cites || []).map(p => S.notes.get(p)).filter(Boolean);
  const body = `<blockquote>${esc(q)}</blockquote>\n${answerHtml(a, { forNote: true })}\n` +
    (srcs.length ? `<h3>Sources</h3><ul>${srcs.map(n => `<li><a class="wikilink" data-link="${esc(n.name)}" href="">${esc(n.name)}</a></li>`).join('')}</ul>` : '');
  await createNote('Answers/' + name, { body, tags: ['ai-answer'] });
  toast('Saved as a note, now part of your graph');
}

/* ---------------------------------------------------------------- settings */
async function openSettings() {
  buildUI();
  $('#settings').hidden = false;
  const body = $('#setBody');
  const st = isNative() ? await hvNative.settings.get() : null;
  const sec = (t, html) => `<section><h4>${t}</h4>${html}</section>`;
  const ai = st ? `
    <div class="ctl"><label>Provider presets</label><span>
      <button class="mini" data-preset="https://api.openai.com/v1|gpt-4o-mini">OpenAI</button>
      <button class="mini" data-preset="http://localhost:11434/v1|llama3.1">Ollama</button>
      <button class="mini" data-preset="http://localhost:1234/v1|local-model">LM Studio</button>
      <button class="mini" data-preset="https://openrouter.ai/api/v1|openai/gpt-4o-mini">OpenRouter</button></span></div>
    <div class="ctl"><label>Base URL</label><input id="sUrl" type="text" value="${esc(st.llm.baseUrl || '')}" placeholder="https://api.openai.com/v1"></div>
    <div class="ctl"><label>Model</label><input id="sModel" type="text" value="${esc(st.llm.model || '')}" placeholder="gpt-4o-mini"></div>
    <div class="ctl"><label>API key</label><input id="sKey" type="password" value="" placeholder="${st.hasKey ? '•••••••• (saved, encrypted)' : 'optional for local models'}" autocomplete="off"></div>
    <div class="ctl"><label>Context budget</label><select id="sCtx">${[6000, 12000, 24000, 48000].map(v => `<option value="${v}"${(st.llm.contextChars || 12000) === v ? ' selected' : ''}>${v / 1000}k characters</option>`).join('')}</select></div>
    <div class="ctl"><span id="sTestOut" class="meta"></span><span><button id="sTest">Test connection</button> <button id="sSaveAi" class="primary">Save</button></span></div>
    <div class="meta">Works with any OpenAI-compatible <code>/chat/completions</code> endpoint. The key is stored encrypted by your OS and never exposed to page content.</div>`
    : '<div class="meta">AI chat and the local API are available in the desktop app.</div>';
  const api = st ? `
    <div class="ctl"><label>Enable local read-only API</label><input id="sApiOn" type="checkbox"${st.api.enabled ? ' checked' : ''}></div>
    <div class="ctl"><label>Port</label><input id="sApiPort" type="text" value="${st.api.port}" style="max-width:90px"></div>
    <div class="ctl"><label>Token</label><input id="sApiTok" type="text" readonly value="${esc(st.api.token)}"><span><button id="sApiCopy" class="mini">Copy</button> <button id="sApiNew" class="mini">New</button></span></div>
    <div class="meta">Bound to 127.0.0.1 only. Use <code>Authorization: Bearer &lt;token&gt;</code>. Endpoints: <code>GET /api/v1/health</code>, <code>/notes</code>, <code>/notes/content?path=</code>, <code>/graph</code>, <code>/related?path=</code>, <code>POST /search {"q":"…"}</code>.</div>
    <div class="ctl"><span></span><button id="sApiSave" class="primary">Apply</button></div>` : '';
  const vault = `
    <div class="ctl"><label>Import Markdown / Obsidian folder</label><button id="sImport">Choose folder…</button></div>
    <div class="ctl"><label>Re-scan vault folder</label><button id="sReload">Reload</button></div>
    ${isNative() && S.backend?.kind === 'native' ? '<div class="ctl"><label>Show vault in Explorer</label><button id="sReveal">Open</button></div>' : ''}
    <input id="sFiles" type="file" webkitdirectory multiple hidden>
    <div class="meta">Import converts <code>.md</code> notes (frontmatter tags, [[wikilinks]], tables, tasks, callouts) into HTML notes. Existing notes are never overwritten.</div>`;
  body.innerHTML = sec('AI assistant', ai) + sec('Local API for agents', api || '<div class="meta">Desktop app only.</div>') + sec('Vault', vault);

  $$('[data-preset]', body).forEach(b => b.onclick = () => { const [u, m] = b.dataset.preset.split('|'); $('#sUrl').value = u; $('#sModel').value = m; });
  const saveAi = async () => {
    await hvNative.settings.set({ llm: { baseUrl: $('#sUrl').value.trim(), model: $('#sModel').value.trim(), contextChars: +$('#sCtx').value } });
    const k = $('#sKey').value; if (k) { await hvNative.settings.setKey(k); $('#sKey').value = ''; $('#sKey').placeholder = '•••••••• (saved, encrypted)'; }
  };
  if ($('#sSaveAi')) {
    $('#sSaveAi').onclick = async () => { await saveAi(); toast('AI settings saved'); };
    $('#sTest').onclick = async () => {
      await saveAi(); $('#sTestOut').textContent = 'Testing…';
      const r = await hvNative.llm.test();
      $('#sTestOut').textContent = r.ok ? '✓ Connected: ' + (r.sample || 'ok') : '✗ ' + r.error;
    };
  }
  if ($('#sApiSave')) {
    $('#sApiSave').onclick = async () => {
      const port = clamp(parseInt($('#sApiPort').value, 10) || 19828, 1024, 65535);
      const r = await hvNative.settings.set({ api: { enabled: $('#sApiOn').checked, port } });
      toast(r?.apiError ? 'API: ' + r.apiError : ($('#sApiOn').checked ? 'API running on 127.0.0.1:' + port : 'API stopped'), 3500);
    };
    $('#sApiNew').onclick = async () => { $('#sApiTok').value = await hvNative.settings.newToken(); };
    $('#sApiCopy').onclick = () => { navigator.clipboard?.writeText($('#sApiTok').value); toast('Token copied'); };
  }
  $('#sReload').onclick = () => { closeSettings(); reloadVault(); };
  if ($('#sReveal')) $('#sReveal').onclick = () => hvNative.vault.reveal(S.backend.root);
  $('#sImport').onclick = async () => {
    if (!S.backend) { toast('Open a vault first'); return; }
    if (isNative()) { const files = await hvNative.import.pickMarkdown(); if (files) { closeSettings(); importMarkdown(files); } }
    else $('#sFiles').click();
  };
  $('#sFiles').onchange = async e => {
    const files = [...e.target.files].filter(f => /\.md$/i.test(f.name));
    const list = await Promise.all(files.map(async f => ({ path: f.webkitRelativePath.split('/').slice(1).join('/'), text: await f.text() })));
    closeSettings(); importMarkdown(list);
  };
}
function closeSettings() { $('#settings').hidden = true; }

/* --------------------------------------------------------- markdown import */
async function importMarkdown(files) {
  if (!files?.length) { toast('No Markdown files found'); return; }
  await flushSave();
  const made = [], sensitive = [];
  let skipped = 0, renamedDupes = 0;
  for (const f of files) {
    const parts = f.path.replace(/\\/g, '/').split('/').filter(Boolean);
    let name = sanitizeName(parts.pop().replace(/\.md$/i, ''));
    // never copy credentials into the new vault (it feeds search, AI chat and the local API)
    if (HVMD.looksSensitive(name, f.text)) { sensitive.push(f.path); continue; }
    const dir = parts.map(sanitizeName).filter(Boolean).join('/');
    if (!name) { skipped++; continue; }
    // note names are unique in a vault: a different note that shares a name gets its folder as a suffix,
    // while the same note imported before (same folder + name) is left alone
    const clash = S.byName.get(lc(name));
    if (clash) {
      if (clash.dir === dir) { skipped++; continue; }
      name = `${name} (${dir.split('/').pop() || 'root'})`;
      if (S.byName.has(lc(name))) { skipped++; continue; }
      renamedDupes++;
    }
    const fm = HVMD.frontmatter(f.text);
    // the note title is stored separately, so drop a leading "# Title" that repeats it
    const html = HVMD.toHtml(fm.body).replace(/^\s*<h1>([^<]*)<\/h1>\s*/, (m, t) => (lc(t.trim()) === lc(name) ? '' : m));
    const obj = makeNoteObj(name, dir, html, fm.tags);
    // placeholder so links between imported notes resolve while serializing
    S.notes.set(obj.path, { ...obj, links: [], allTags: [], text: '', plain: '' });
    S.byName.set(lc(name), S.notes.get(obj.path));
    made.push(obj);
  }
  reindex();
  let done = 0;
  for (const obj of made) {
    const text = serializeNote(obj);
    obj.mtime = await S.backend.write(obj.path, text);
    S.notes.set(obj.path, parseNote(obj.path, text, obj.mtime));
    if (++done % 25 === 0) toast(`Importing… ${done}/${made.length}`, 1500);
  }
  reindex();
  if (!S.cfg.groups.length) S.cfg.groups = autoGroups();
  refreshAll();
  toast(`Imported ${made.length} note${made.length === 1 ? '' : 's'}${renamedDupes ? ` (${renamedDupes} renamed with a folder suffix because the name was taken)` : ''}${skipped ? `, ${skipped} already present` : ''}`, 6000);
  if (sensitive.length) {
    await ask(`Skipped ${sensitive.length} note${sensitive.length === 1 ? '' : 's'} that look like they contain credentials`, {
      message: sensitive.join(', ') + '. They were not copied. Review them in the source folder.', confirm: true, ok: 'OK' });
  }
}

/* ------------------------------------------------------------ local API */
function handleApi(req) {
  if (!S.backend) return { status: 503, body: { error: 'No vault is open' } };
  const d = analysisData(), p = req.path;
  const note = n => ({ path: n.path, name: n.name, tags: n.allTags, links: n.links, updated: n.updated });
  if (req.method === 'GET' && p === '/api/v1/health') return { status: 200, body: { ok: true, vault: S.backend.name, notes: S.notes.size } };
  if (req.method === 'GET' && p === '/api/v1/notes') return { status: 200, body: d.notes.map(note) };
  if (req.method === 'GET' && p === '/api/v1/notes/content') {
    const n = S.notes.get(req.query.path);
    return n ? { status: 200, body: { ...note(n), html: n.body, text: n.plain.slice(0, 200000) } } : { status: 404, body: { error: 'Note not found' } };
  }
  if (req.method === 'POST' && p === '/api/v1/search') {
    const q = String(req.body?.q || ''), limit = clamp(+req.body?.limit || 20, 1, 100);
    return { status: 200, body: { results: HVA.search(d.docs, q, { limit }).map(r => ({ path: r.id, name: S.notes.get(r.id).name, score: r.score, snippet: r.snippet })) } };
  }
  if (req.method === 'GET' && p === '/api/v1/graph') {
    const comm = HVA.louvain(d.nodes.map(n => n.id), d.edges);
    return { status: 200, body: { nodes: d.nodes.map(n => ({ id: n.id, name: n.label, tags: n.tags, community: comm.get(n.id) })), edges: d.edges } };
  }
  if (req.method === 'GET' && p === '/api/v1/related') {
    if (!S.notes.has(req.query.path)) return { status: 404, body: { error: 'Note not found' } };
    return { status: 200, body: { related: HVA.related(req.query.path, d.ctx, 15).map(r => ({ path: r.id, name: S.notes.get(r.id)?.name, score: r.score, signals: r.signals })) } };
  }
  return { status: 404, body: { error: 'Unknown endpoint' } };
}

/* -------------------------------------------------------------- lifecycle */
function onVaultOpened(be) {
  FX.cache = { ver: -1 };
  if (isNative()) {
    if (be.kind === 'native') { hvNative.vault.watch(be.root); hvNative.settings.set({ lastVault: be.root }); }
    else hvNative.vault.unwatch();
  }
  FX.chat.msgs = []; renderChat();
}
function menuCommand(cmd) {
  if (cmd === 'open-vault') $('#btnVault').click();
  else if (cmd === 'new-note') $('#btnNew').click();
  else if (cmd === 'import-md') { openSettings().then(() => $('#sImport')?.click()); }
  else if (cmd === 'search') openSearch();
  else if (cmd === 'ask') openChat();
  else if (cmd === 'settings') openSettings();
  else if (cmd === 'toggle-theme') $('#btnTheme').click();
  else if (cmd.startsWith('view-')) setView(cmd.slice(5));
}
function initFeatures() {
  buildUI();
  $('#btnSearch').onclick = () => openSearch();
  $('#btnAsk').onclick = () => ($('#chat').hidden ? openChat() : closeChat());
  $('#btnSettings').onclick = openSettings;
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); }
    else if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); openSearch(); }
    else if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); $('#btnAsk').click(); }
    else if (mod && e.key === ',') { e.preventDefault(); openSettings(); }
    else if (e.key === 'Escape') { if (!$('#qs').hidden) closeSearch(); else if (!$('#settings').hidden) closeSettings(); }
  });
  if (isNative()) {
    hvNative.vault.onChanged(() => { if (!S.dirty && S.backend?.kind === 'native') reloadVault().catch(() => {}); });
    hvNative.api.onRequest(handleApi);
    hvNative.onMenu(menuCommand);
    hvNative.onFlush(() => flushSave());     // save pending edits before the window closes
  }
}
