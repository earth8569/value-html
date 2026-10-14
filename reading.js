/* Reading features for long notes: outline, reading mode, foldable sections.
   Loaded before the app script; everything here runs lazily, so it can use the app's globals ($, esc, S, ...)
   at call time. Fold state, flash highlights and the outline are view-only: they never reach the saved file. */
'use strict';
const RD = {
  on: false, heads: [], active: -1, spy: 0,
  prefs: { size: 17, width: 'medium', lh: 1.7, serif: false, sepia: false },
};
const RD_WIDTHS = { narrow: '36rem', medium: '46rem', wide: '62rem', full: '100%' };
const RD_FOLD_CLASSES = ['hv-folded', 'hv-fold-hidden', 'hv-flash'];   // stripped on save (see fixLinksForSave)
const rdEd = () => document.getElementById('editor');
const rdLevel = el => (el && /^H[1-4]$/.test(el.tagName) ? +el.tagName[1] : 0);

/* ---------------------------------------------------------------- folding */
function rdBlocks() { return [...rdEd().children]; }
function applyFolds() {
  const blocks = rdBlocks();
  const hidden = HVFold.plan(blocks.map(rdLevel), blocks.map(b => b.classList.contains('hv-folded')));
  blocks.forEach((b, i) => b.classList.toggle('hv-fold-hidden', hidden[i]));
  rdSpy();
}
function toggleFold(h) { h.classList.toggle('hv-folded'); applyFolds(); }
function foldAll() {
  const blocks = rdBlocks(), L = HVFold.foldAllLevel(blocks.map(rdLevel));
  if (!L) { toast('No sections to fold in this note'); return; }
  blocks.forEach(b => b.classList.toggle('hv-folded', rdLevel(b) === L));
  applyFolds();
}
function unfoldAll() {
  const ed = rdEd();
  ed.querySelectorAll('.hv-folded,.hv-fold-hidden').forEach(e => e.classList.remove('hv-folded', 'hv-fold-hidden'));
}
/** Unfold whatever hides heading/block `el` so it can be scrolled to. */
function revealBlock(el) {
  let guard = 50;
  while (el.classList.contains('hv-fold-hidden') && guard--) {
    const blocks = rdBlocks(), i = blocks.indexOf(el);
    const folded = blocks.map(b => b.classList.contains('hv-folded'));
    const fix = HVFold.revealing(blocks.map(rdLevel), folded, i);
    if (!fix.length) break;
    fix.forEach(j => blocks[j].classList.remove('hv-folded'));
    applyFolds();
  }
}

/* ---------------------------------------------------------------- outline */
function rdHeadings() { return [...rdEd().querySelectorAll('h1,h2,h3,h4')].filter(h => h.textContent.trim()); }
function outlineHtml() {
  const hs = RD.heads = rdHeadings();
  if (!hs.length) return '<div class="ol-empty">No headings in this note</div>';
  const min = Math.min(...hs.map(rdLevel));
  return hs.map((h, i) => {
    const t = h.textContent.trim().replace(/\s+/g, ' ');
    return `<a class="ol l${Math.min(rdLevel(h) - min, 3)}" data-i="${i}" title="${esc(t)}">${esc(t)}</a>`;
  }).join('');
}
function renderOutline() {
  const html = outlineHtml();
  const side = document.querySelector('#outline .ol-list');
  if (side) side.innerHTML = html;
  const pop = document.getElementById('outlinePop');
  if (pop && !pop.hidden) pop.innerHTML = html;
  RD.active = -1; rdSpy();
}
function goHeading(i) {
  const h = RD.heads[i]; if (!h) return;
  revealBlock(h);
  const sc = document.getElementById('noteScroll');
  const delta = h.getBoundingClientRect().top - sc.getBoundingClientRect().top - 16;
  // short hops glide; a long jump through a 13,000-word note would take seconds to animate, so it just lands
  sc.scrollTo({ top: Math.max(0, sc.scrollTop + delta), behavior: Math.abs(delta) > sc.clientHeight * 1.5 ? 'instant' : 'smooth' });
  h.classList.add('hv-flash'); setTimeout(() => h.classList.remove('hv-flash'), 1400);
  closeOutlinePop();
}
/** Highlight the section you are reading in the outline. */
function rdSpy() {
  RD.spy = 0;
  const hs = RD.heads; if (!hs.length) return;
  const top = document.getElementById('noteScroll').getBoundingClientRect().top;
  let a = -1;
  for (let i = 0; i < hs.length; i++) {
    if (hs[i].classList.contains('hv-fold-hidden')) continue;
    if (hs[i].getBoundingClientRect().top - top <= 90) a = i; else break;
  }
  if (a === RD.active) return;
  RD.active = a;
  document.querySelectorAll('.ol.on').forEach(x => x.classList.remove('on'));
  if (a >= 0) document.querySelectorAll(`.ol[data-i="${a}"]`).forEach(x => { x.classList.add('on'); x.scrollIntoView({ block: 'nearest' }); });
}
/** Called at the end of renderRight(): the outline lives at the top of the details panel. */
function readingOnRight() {
  const r = document.getElementById('right'); if (!r) return;
  const o = document.createElement('div');
  o.id = 'outline'; o.innerHTML = '<h4>Outline</h4><div class="ol-list"></div>';
  r.prepend(o); renderOutline();
}
/** Called after a note is loaded into the editor. */
function readingOnLoad() {
  if (!document.getElementById('readbar')) return;       // not initialised yet
  renderOutline(); updateReadStats();
  document.getElementById('noteScroll').scrollTop = 0;
}
function openOutlinePop(btn) {
  const pop = document.getElementById('outlinePop');
  pop.innerHTML = outlineHtml(); pop.hidden = false;
  const r = btn.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - 350)) + 'px';
  pop.style.top = (r.bottom + 6) + 'px';
  RD.active = -1; rdSpy();
}
function closeOutlinePop() { const p = document.getElementById('outlinePop'); if (p) p.hidden = true; }

/* ------------------------------------------------------------ reading mode */
function updateReadStats() {
  const el = document.getElementById('rdStats'); if (!el) return;
  const s = HVFold.readingStats(rdEd().innerText);
  el.textContent = `${s.words.toLocaleString()} words · ~${s.minutes} min`;
}
function setReading(on, { silent = false } = {}) {
  if (on && !RD.on) flushSave();                          // save what you typed before locking the page
  RD.on = on;
  document.body.classList.toggle('reading', on);
  rdEd().contentEditable = on ? 'false' : 'true';
  document.getElementById('title').readOnly = on;
  if (!on) unfoldAll();                                   // never edit with hidden sections
  if (typeof closeLP === 'function') closeLP();
  updateReadStats(); renderOutline();
  try { localStorage.setItem('hv:reading', on ? '1' : '0'); } catch {}
  if (!silent) toast(on ? 'Reading mode · Ctrl+E to edit' : 'Editing', 1400);
}
function applyReadPrefs() {
  const p = RD.prefs, sc = document.getElementById('noteScroll');
  sc.style.setProperty('--read-size', p.size + 'px');
  sc.style.setProperty('--read-width', RD_WIDTHS[p.width] || RD_WIDTHS.medium);
  sc.style.setProperty('--read-lh', p.lh);
  document.body.classList.toggle('rd-serif', !!p.serif);
  document.body.classList.toggle('rd-sepia', !!p.sepia);
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = String(v); };
  set('rdWidth', p.width); set('rdLh', p.lh); set('rdFont', p.serif ? 'serif' : 'sans'); set('rdTheme', p.sepia ? 'sepia' : 'default');
  try { localStorage.setItem('hv:readPrefs', JSON.stringify(p)); } catch {}
}

function initReading() {
  try { Object.assign(RD.prefs, JSON.parse(localStorage.getItem('hv:readPrefs') || '{}')); } catch {}
  const bar = document.createElement('div');
  bar.id = 'readbar';
  bar.innerHTML = `
    <button id="rdEdit" title="Back to editing (Ctrl+E)">✎ Edit</button><span class="sep"></span>
    <button id="rdSmaller" title="Smaller text">A−</button><button id="rdBigger" title="Larger text">A+</button>
    <select id="rdWidth" title="Line width"><option value="narrow">Narrow</option><option value="medium">Medium</option><option value="wide">Wide</option><option value="full">Full</option></select>
    <select id="rdLh" title="Line spacing"><option value="1.45">Tight</option><option value="1.7">Normal</option><option value="1.95">Relaxed</option></select>
    <select id="rdFont" title="Font"><option value="sans">Sans</option><option value="serif">Serif</option></select>
    <select id="rdTheme" title="Page colour"><option value="default">Default</option><option value="sepia">Sepia</option></select><span class="sep"></span>
    <button id="rdFold" title="Fold every section">⊟ Fold all</button><button id="rdUnfold" title="Open every section">⊞ Unfold all</button>
    <button id="rdOutline" title="Outline of this note">☰ Outline</button>
    <span id="rdStats"></span>`;
  document.getElementById('notePane').insertBefore(bar, document.getElementById('noteScroll'));
  const pop = document.createElement('div'); pop.id = 'outlinePop'; pop.hidden = true;
  document.body.appendChild(pop);

  // edit-mode toolbar gets a way in
  const tb = document.getElementById('toolbar');
  const sep = document.createElement('span'); sep.className = 'sep'; tb.appendChild(sep);
  for (const [label, title, fn] of [['📖 Read', 'Reading mode (Ctrl+E)', () => setReading(true)], ['☰', 'Outline of this note', b => openOutlinePop(b)]]) {
    const b = document.createElement('button'); b.textContent = label; b.title = title;
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => fn(b)); tb.appendChild(b);
  }

  const $id = id => document.getElementById(id);
  $id('rdEdit').onclick = () => setReading(false);
  $id('rdSmaller').onclick = () => { RD.prefs.size = Math.max(13, RD.prefs.size - 1); applyReadPrefs(); };
  $id('rdBigger').onclick = () => { RD.prefs.size = Math.min(26, RD.prefs.size + 1); applyReadPrefs(); };
  $id('rdWidth').onchange = e => { RD.prefs.width = e.target.value; applyReadPrefs(); };
  $id('rdLh').onchange = e => { RD.prefs.lh = +e.target.value; applyReadPrefs(); };
  $id('rdFont').onchange = e => { RD.prefs.serif = e.target.value === 'serif'; applyReadPrefs(); };
  $id('rdTheme').onchange = e => { RD.prefs.sepia = e.target.value === 'sepia'; applyReadPrefs(); };
  $id('rdFold').onclick = foldAll;
  $id('rdUnfold').onclick = () => { unfoldAll(); rdSpy(); };
  $id('rdOutline').onclick = e => { const p = $id('outlinePop'); if (p.hidden) openOutlinePop(e.currentTarget); else closeOutlinePop(); e.stopPropagation(); };

  // outline entries (side panel and pop-up)
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('.ol');
    if (a) { goHeading(+a.dataset.i); return; }
    const p = $id('outlinePop');
    if (!p.hidden && !p.contains(e.target) && !e.target.closest('#rdOutline') && !e.target.closest('#toolbar')) closeOutlinePop();
  });
  // fold / unfold by clicking the arrow in a heading's left margin (reading mode only)
  rdEd().addEventListener('click', e => {
    if (!RD.on) return;
    const h = e.target.closest && e.target.closest('h1,h2,h3,h4');
    if (!h || h.parentElement !== rdEd()) return;
    const gutter = Math.max(24, parseFloat(getComputedStyle(h).fontSize) * 1.2);
    if (e.clientX - h.getBoundingClientRect().left <= gutter) { e.preventDefault(); e.stopPropagation(); toggleFold(h); }
  }, true);
  // keep the outline and stats current while editing; track scroll position
  rdEd().addEventListener('input', debounce(() => { renderOutline(); updateReadStats(); }, 400));
  document.getElementById('noteScroll').addEventListener('scroll', () => { if (!RD.spy) RD.spy = requestAnimationFrame(rdSpy); }, { passive: true });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e') { e.preventDefault(); setReading(!RD.on); }
    else if (e.key === 'Escape') closeOutlinePop();
  });

  applyReadPrefs();
  let on = false; try { on = localStorage.getItem('hv:reading') === '1'; } catch {}
  setReading(on, { silent: true });
}
