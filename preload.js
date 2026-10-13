/* Preload: the only bridge between the page and the main process. */
const { contextBridge, ipcRenderer } = require('electron');
const inv = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('hvNative', {
  platform: process.platform,
  vault: {
    pick: () => inv('vault:pick'),
    exists: r => inv('vault:exists', r),
    scan: r => inv('vault:scan', r),
    write: (r, p, text) => inv('vault:write', r, p, text),
    remove: (r, p) => inv('vault:remove', r, p),
    readText: (r, p) => inv('vault:readText', r, p),
    reveal: r => inv('vault:reveal', r),
    watch: r => inv('vault:watch', r),
    unwatch: () => inv('vault:unwatch'),
    onChanged: cb => { ipcRenderer.on('vault:changed', () => cb()); },
  },
  settings: {
    get: () => inv('settings:get'),
    set: patch => inv('settings:set', patch),
    setKey: key => inv('settings:setKey', key),
    newToken: () => inv('settings:newToken'),
  },
  llm: {
    start: (id, messages) => inv('llm:start', id, messages),
    cancel: id => inv('llm:cancel', id),
    test: () => inv('llm:test'),
    onEvent: cb => { ipcRenderer.on('llm:event', (_e, ev) => cb(ev)); },
  },
  api: {
    onRequest: cb => {
      ipcRenderer.on('api:request', async (_e, req) => {
        let r;
        try { r = await cb(req); } catch (err) { r = { status: 500, body: { error: String(err && err.message || err) } }; }
        ipcRenderer.send('api:response', { id: req.id, status: r.status, body: r.body });
      });
    },
  },
  import: { pickMarkdown: () => inv('import:md') },
  onMenu: cb => { ipcRenderer.on('menu', (_e, c) => cb(c)); },
  onFlush: cb => {
    ipcRenderer.on('app:flush', async () => { try { await cb(); } finally { ipcRenderer.send('app:flushed'); } });
  },
});
