/* Value HTML: Electron main process.
   - opens the app window (sandboxed, no node in the page)
   - gives the page folder access ONLY inside vault folders the user picked
   - watches the vault for outside changes
   - streams LLM answers (key stays here, encrypted with the OS keychain)
   - optional token-protected read-only API on 127.0.0.1 for AI agents */
const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const APP_URL = pathToFileURL(__dirname).href;
let win = null;
let forceClose = false;

/* ----------------------------------------------------------- settings */
const DEFAULTS = {
  lastVault: null, window: null,
  llm: { baseUrl: '', model: '', contextChars: 12000 },
  apiKeyEnc: null,
  api: { enabled: false, port: 19828, token: '' },
};
let settings = structuredClone(DEFAULTS);
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try {
    const j = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = { ...DEFAULTS, ...j, llm: { ...DEFAULTS.llm, ...j.llm }, api: { ...DEFAULTS.api, ...j.api } };
  } catch { settings = structuredClone(DEFAULTS); }
  if (!settings.api.token) { settings.api.token = crypto.randomBytes(24).toString('hex'); saveSettings(); }
}
function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}
const publicSettings = () => ({
  lastVault: settings.lastVault, llm: settings.llm, hasKey: !!settings.apiKeyEnc, api: settings.api,
});
function setKey(key) {
  if (!key) { settings.apiKeyEnc = null; return; }
  settings.apiKeyEnc = safeStorage.isEncryptionAvailable()
    ? 'enc:' + safeStorage.encryptString(key).toString('base64')
    : 'plain:' + key;
}
function getKey() {
  const v = settings.apiKeyEnc;
  if (!v) return '';
  try {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
    if (v.startsWith('plain:')) return v.slice(6);
  } catch { /* key unreadable (e.g. different OS user) */ }
  return '';
}

/* ------------------------------------------------------- vault access */
const allowedRoots = new Set();       // folders the user chose; the page may only touch these
const norm = p => path.resolve(p);
function root(r) {
  const n = norm(String(r));
  if (!allowedRoots.has(n)) throw new Error('Vault folder not authorised');
  return n;
}
function inside(rootDir, rel) {
  const full = path.resolve(rootDir, String(rel));
  if (full !== rootDir && !full.startsWith(rootDir + path.sep)) throw new Error('Path escapes the vault');
  return full;
}
async function walk(dir, visit, { skipHidden = true, depth = 0 } = {}) {
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if ((skipHidden && e.name.startsWith('.')) || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 30) await walk(full, visit, { skipHidden, depth: depth + 1 }); }
    else if (e.isFile()) await visit(full, e.name);
  }
}

/* ----------------------------------------------------------------- ipc */
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!e.senderFrame || !e.senderFrame.url.startsWith(APP_URL)) throw new Error('Untrusted sender');
    return fn(e, ...args);
  });
}

handle('vault:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose your vault folder', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  allowedRoots.add(norm(r.filePaths[0]));
  return r.filePaths[0];
});
handle('vault:exists', async (e, r) => {
  const n = norm(r);
  if (!allowedRoots.has(n)) return false;
  try { return (await fsp.stat(n)).isDirectory(); } catch { return false; }
});
handle('vault:scan', async (e, r) => {
  const rootDir = root(r), out = [];
  await walk(rootDir, async (full, name) => {
    if (!/\.html?$/i.test(name)) return;
    const st = await fsp.stat(full);
    if (st.size > 20e6) return;
    out.push({ path: path.relative(rootDir, full).split(path.sep).join('/'), text: await fsp.readFile(full, 'utf8'), mtime: Math.floor(st.mtimeMs) });
  });
  return out;
});
handle('vault:write', async (e, r, rel, text) => {
  const rootDir = root(r), full = inside(rootDir, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  const tmp = full + '.tmp-' + process.pid;
  await fsp.writeFile(tmp, String(text), 'utf8');
  await fsp.rename(tmp, full);             // atomic: never leaves a half-written note
  return Math.floor((await fsp.stat(full)).mtimeMs);
});
handle('vault:remove', async (e, r, rel) => { await fsp.rm(inside(root(r), rel), { force: true }); });
handle('vault:readText', async (e, r, rel) => {
  try { return await fsp.readFile(inside(root(r), rel), 'utf8'); } catch { return null; }
});
handle('vault:reveal', (e, r) => shell.openPath(root(r)));

let watcher = null, watchTimer = null;
handle('vault:watch', (e, r) => {
  const rootDir = root(r);
  if (watcher) watcher.close();
  try {
    watcher = fs.watch(rootDir, { recursive: true }, (evt, name) => {
      if (name && (/(^|[\\/])\./.test(name) || /\.tmp-\d+$/.test(name))) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => win && !win.isDestroyed() && win.webContents.send('vault:changed'), 500);
    });
    watcher.on('error', () => {});
  } catch (err) { console.error('watch failed', err.message); }
});
handle('vault:unwatch', () => { if (watcher) { watcher.close(); watcher = null; } });

handle('import:md', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a folder of Markdown notes', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const base = r.filePaths[0], out = [];
  await walk(base, async (full, name) => {
    if (!/\.md$/i.test(name) || out.length >= 5000) return;
    const st = await fsp.stat(full);
    if (st.size > 5e6) return;
    out.push({
      path: path.relative(base, full).split(path.sep).join('/'), text: await fsp.readFile(full, 'utf8'),
      // keep the real dates so the graph replay can show the vault growing over time
      created: new Date(st.birthtimeMs || st.mtimeMs).toISOString(), modified: new Date(st.mtimeMs).toISOString(),
    });
  });
  return out;
});

handle('settings:get', () => publicSettings());
handle('settings:set', async (e, patch = {}) => {
  const res = {};
  if (typeof patch.lastVault === 'string' && allowedRoots.has(norm(patch.lastVault))) settings.lastVault = patch.lastVault;
  if (patch.llm) {
    const l = patch.llm;
    if (typeof l.baseUrl === 'string') settings.llm.baseUrl = l.baseUrl.trim();
    if (typeof l.model === 'string') settings.llm.model = l.model.trim();
    if (Number.isFinite(l.contextChars)) settings.llm.contextChars = Math.min(Math.max(l.contextChars, 2000), 200000);
  }
  if (patch.api) {
    if (typeof patch.api.enabled === 'boolean') settings.api.enabled = patch.api.enabled;
    if (Number.isInteger(patch.api.port)) settings.api.port = Math.min(Math.max(patch.api.port, 1024), 65535);
  }
  saveSettings();
  if (patch.api) {
    try { await restartApi(); } catch (err) { settings.api.enabled = false; saveSettings(); res.apiError = err.code === 'EADDRINUSE' ? `port ${settings.api.port} is already in use` : err.message; }
  }
  return res;
});
handle('settings:setKey', (e, key) => { setKey(String(key || '')); saveSettings(); });
handle('settings:newToken', () => { settings.api.token = crypto.randomBytes(24).toString('hex'); saveSettings(); return settings.api.token; });

/* ----------------------------------------------------------------- LLM */
const llmJobs = new Map();
function llmUrl() {
  const base = settings.llm.baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('Base URL must start with http:// or https://');
  return base + '/chat/completions';
}
const llmHeaders = () => {
  const key = getKey();
  return { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) };
};
async function runLlm(wc, id, messages) {
  const ac = new AbortController();
  llmJobs.set(id, ac);
  const send = o => { if (!wc.isDestroyed()) wc.send('llm:event', { id, ...o }); };
  try {
    const res = await fetch(llmUrl(), {
      method: 'POST', signal: ac.signal, headers: llmHeaders(),
      body: JSON.stringify({ model: settings.llm.model, messages, stream: true, temperature: 0.3 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {
      const j = await res.json();
      send({ type: 'delta', delta: j.choices?.[0]?.message?.content ?? '' });
    } else {
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '', inThink = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let d; try { d = JSON.parse(data).choices?.[0]?.delta; } catch { continue; }
          if (!d) continue;
          if (d.reasoning_content) { send({ type: 'delta', delta: (inThink ? '' : '<think>') + d.reasoning_content }); inThink = true; }
          if (d.content) { send({ type: 'delta', delta: (inThink ? '</think>' : '') + d.content }); inThink = false; }
        }
      }
    }
    send({ type: 'done' });
  } catch (err) {
    if (err.name === 'AbortError') send({ type: 'done' });
    else send({ type: 'error', error: err.cause?.code === 'ECONNREFUSED' ? 'Connection refused. Is the model server running?' : err.message });
  } finally { llmJobs.delete(id); }
}
handle('llm:start', (e, id, messages) => {
  if (!settings.llm.baseUrl || !settings.llm.model) throw new Error('AI is not configured');
  if (!Array.isArray(messages) || messages.length > 50) throw new Error('Bad messages');
  runLlm(e.sender, String(id), messages.map(m => ({ role: String(m.role), content: String(m.content) })));
});
handle('llm:cancel', (e, id) => { llmJobs.get(String(id))?.abort(); });
handle('llm:test', async () => {
  try {
    const res = await fetch(llmUrl(), {
      method: 'POST', headers: llmHeaders(), signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ model: settings.llm.model, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 8 }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` };
    const j = await res.json();
    return { ok: true, sample: String(j.choices?.[0]?.message?.content ?? '').trim().slice(0, 40) };
  } catch (err) { return { ok: false, error: err.cause?.code === 'ECONNREFUSED' ? 'Connection refused' : err.message }; }
});

/* ---------------------------------------------------- local read-only API */
let apiServer = null;
const apiPending = new Map();
ipcMain.on('api:response', (e, r) => {
  if (!e.senderFrame || !e.senderFrame.url.startsWith(APP_URL)) return;
  const p = apiPending.get(r?.id);
  if (p) { apiPending.delete(r.id); p(r); }
});
function tokenOk(header) {
  const want = Buffer.from('Bearer ' + settings.api.token), got = Buffer.from(String(header || ''));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
function apiHandler(req, res) {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) return send(403, { error: 'Bad host' });
  if (!tokenOk(req.headers.authorization)) return send(401, { error: 'Missing or invalid token' });
  if (req.method !== 'GET' && req.method !== 'POST') return send(405, { error: 'Method not allowed' });
  const url = new URL(req.url, 'http://127.0.0.1');
  const chunks = []; let size = 0;
  req.on('data', c => { size += c.length; if (size > 1e6) { send(413, { error: 'Body too large' }); req.destroy(); } else chunks.push(c); });
  req.on('end', () => {
    if (res.writableEnded || !win || win.isDestroyed()) return;
    let body = null;
    if (chunks.length) { try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'Invalid JSON' }); } }
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { apiPending.delete(id); send(504, { error: 'Timed out' }); }, 15000);
    apiPending.set(id, r => { clearTimeout(timer); send(r.status || 200, r.body ?? {}); });
    win.webContents.send('api:request', { id, method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
  });
}
function stopApi() { if (apiServer) { apiServer.close(); apiServer = null; } }
function restartApi() {
  stopApi();
  if (!settings.api.enabled) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const srv = http.createServer(apiHandler);
    srv.once('error', reject);
    srv.listen(settings.api.port, '127.0.0.1', () => { apiServer = srv; resolve(); });
  });
}

/* ------------------------------------------------------------- window */
function createWindow() {
  const b = settings.window || {};
  win = new BrowserWindow({
    width: b.width || 1400, height: b.height || 900, x: b.x, y: b.y, minWidth: 760, minHeight: 520,
    backgroundColor: '#16181d', title: 'Value HTML', show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  if (b.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'index.html'));

  // links in notes open in the system browser; the app itself never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(APP_URL)) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
  win.webContents.on('will-prevent-unload', e => e.preventDefault());

  // let the page save pending edits before the window closes
  win.on('close', e => {
    if (!win.isMaximized() && !win.isMinimized()) settings.window = { ...win.getBounds() };
    else if (settings.window) settings.window.maximized = win.isMaximized();
    saveSettings();
    if (forceClose) return;
    e.preventDefault();
    win.webContents.send('app:flush');
    setTimeout(() => { forceClose = true; if (win && !win.isDestroyed()) win.close(); }, 3000);
  });
  win.on('closed', () => { win = null; });
}
ipcMain.on('app:flushed', e => {
  if (!e.senderFrame || !e.senderFrame.url.startsWith(APP_URL)) return;
  forceClose = true; if (win && !win.isDestroyed()) win.close();
});

function buildMenu() {
  const cmd = c => () => win && win.webContents.send('menu', c);
  const item = (label, c, accelerator) => ({ label, click: cmd(c), accelerator, registerAccelerator: false });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      item('Open vault…', 'open-vault'), item('New note', 'new-note', 'Ctrl+Alt+N'), item('Import Markdown folder…', 'import-md'),
      { type: 'separator' }, item('Settings…', 'settings', 'Ctrl+,'), { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Go', submenu: [item('Search notes…', 'search', 'Ctrl+Shift+F'), item('Ask your notes…', 'ask', 'Ctrl+L')] },
    { label: 'View', submenu: [
      item('Note only', 'view-note'), item('Note + graph', 'view-split'), item('Graph only', 'view-graph', 'Ctrl+G'),
      { type: 'separator' }, item('Toggle light / dark', 'toggle-theme'), { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }])] },
  ]));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.setAppUserModelId('com.earth8569.valuehtml');
  app.whenReady().then(async () => {
    loadSettings();
    if (settings.lastVault) allowedRoots.add(norm(settings.lastVault));
    buildMenu();
    createWindow();
    restartApi().catch(err => { settings.api.enabled = false; saveSettings(); console.error('API failed to start:', err.message); });
  });
  app.on('window-all-closed', () => { stopApi(); app.quit(); });
}
