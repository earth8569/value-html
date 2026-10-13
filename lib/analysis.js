/* Graph + search analysis for Value HTML.
   Pure functions, no DOM: works in the app and under node (see test/analysis.test.js).
   Ideas (community detection, relevance signals, graph insights) are standard
   graph techniques; this is an independent implementation. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HVA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------ Louvain communities */
  /** ids: string[]; edges: {a,b}[] (undirected, deduped). Returns Map id -> community index,
   *  index 0 is the largest community. Isolated nodes each get their own community. */
  function louvain(ids, edges) {
    const n = ids.length;
    const index = new Map(ids.map((id, i) => [id, i]));
    let adj = ids.map(() => new Map());
    for (const e of edges) {
      const a = index.get(e.a), b = index.get(e.b);
      if (a === undefined || b === undefined || a === b) continue;
      adj[a].set(b, (adj[a].get(b) || 0) + 1);
      adj[b].set(a, (adj[b].get(a) || 0) + 1);
    }
    let members = ids.map((_, i) => [i]);
    let N = n;
    for (let level = 0; level < 20; level++) {
      const k = adj.map(m => { let s = 0; for (const w of m.values()) s += w; return s; });
      const m2 = k.reduce((s, x) => s + x, 0);
      if (m2 === 0) break;
      const comm = Array.from({ length: N }, (_, i) => i);
      const tot = k.slice();
      let moved = false, improved = true, guard = 0;
      while (improved && guard++ < 50) {
        improved = false;
        for (let i = 0; i < N; i++) {
          const ci = comm[i];
          const links = new Map();
          for (const [j, w] of adj[i]) if (j !== i) links.set(comm[j], (links.get(comm[j]) || 0) + w);
          tot[ci] -= k[i];
          let best = ci, bestGain = (links.get(ci) || 0) - tot[ci] * k[i] / m2;
          for (const [c, w] of links) {
            const gain = w - tot[c] * k[i] / m2;
            if (gain > bestGain + 1e-12) { best = c; bestGain = gain; }
          }
          tot[best] += k[i];
          if (best !== ci) { comm[i] = best; improved = true; moved = true; }
        }
      }
      if (!moved) break;
      const remap = new Map();
      for (const c of comm) if (!remap.has(c)) remap.set(c, remap.size);
      const newAdj = Array.from({ length: remap.size }, () => new Map());
      const newMembers = Array.from({ length: remap.size }, () => []);
      for (let i = 0; i < N; i++) {
        const ci = remap.get(comm[i]);
        newMembers[ci].push(...members[i]);
        for (const [j, w] of adj[i]) {
          const cj = remap.get(comm[j]);
          newAdj[ci].set(cj, (newAdj[ci].get(cj) || 0) + w);
        }
      }
      adj = newAdj; members = newMembers; N = remap.size;
    }
    const groups = members.map(m => m.slice().sort((x, y) => x - y)).sort((x, y) => y.length - x.length || x[0] - y[0]);
    const out = new Map();
    groups.forEach((g, ci) => g.forEach(i => out.set(ids[i], ci)));
    return out;
  }

  /** Intra-community edge density: actual intra edges / possible edges. */
  function cohesion(comm, edges) {
    const size = new Map(), intra = new Map();
    for (const c of comm.values()) size.set(c, (size.get(c) || 0) + 1);
    for (const e of edges) {
      const ca = comm.get(e.a);
      if (ca !== undefined && ca === comm.get(e.b)) intra.set(ca, (intra.get(ca) || 0) + 1);
    }
    const out = new Map();
    for (const [c, s] of size) out.set(c, s < 2 ? 1 : Math.min(1, (intra.get(c) || 0) / (s * (s - 1) / 2)));
    return out;
  }

  /* --------------------------------------------------------- relevance */
  /** Build a context for relevance scoring.
   *  nodes: {id, tags?: string[], type?: string}[]; edges: {a,b}[] */
  function buildContext(nodes, edges) {
    const adj = new Map(), tags = new Map(), type = new Map();
    for (const n of nodes) { adj.set(n.id, new Set()); tags.set(n.id, new Set(n.tags || [])); type.set(n.id, n.type ?? ''); }
    for (const e of edges) {
      if (e.a === e.b || !adj.has(e.a) || !adj.has(e.b)) continue;
      adj.get(e.a).add(e.b); adj.get(e.b).add(e.a);
    }
    return { adj, tags, type, ids: nodes.map(n => n.id) };
  }
  const W = { direct: 3, tags: 4, adamic: 1.5, type: 1 };
  /** Four signals: direct link, shared tags (the "same source" analogue), Adamic-Adar, same type. */
  function relevance(a, b, ctx) {
    const na = ctx.adj.get(a), nb = ctx.adj.get(b);
    if (!na || !nb || a === b) return { score: 0, signals: {} };
    const direct = na.has(b) ? 1 : 0;
    let shared = 0;
    const ta = ctx.tags.get(a), tb = ctx.tags.get(b);
    for (const t of ta) if (tb.has(t)) shared++;
    let aa = 0;
    for (const z of na) if (nb.has(z)) aa += 1 / Math.log(Math.max(ctx.adj.get(z).size, 2));
    const sameType = ctx.type.get(a) !== '' && ctx.type.get(a) === ctx.type.get(b) ? 1 : 0;
    const base = direct * W.direct + shared * W.tags + aa * W.adamic;
    return { score: base + (base > 0 ? sameType * W.type : 0), signals: { direct, sharedTags: shared, adamicAdar: +aa.toFixed(3), sameType } };
  }
  function related(id, ctx, k = 8) {
    const out = [];
    for (const other of ctx.ids) {
      if (other === id) continue;
      const r = relevance(id, other, ctx);
      if (r.score > 0) out.push({ id: other, score: r.score, signals: r.signals });
    }
    return out.sort((x, y) => y.score - x.score).slice(0, k);
  }

  /* ---------------------------------------------------------- insights */
  /** nodes: {id,label,type?}[]; edges; comm: Map; coh: Map.
   *  Returns {surprising, isolated, sparse, bridges} */
  function insights(nodes, edges, comm, coh) {
    const deg = new Map(nodes.map(n => [n.id, 0]));
    const nbrs = new Map(nodes.map(n => [n.id, new Set()]));
    for (const e of edges) {
      if (!deg.has(e.a) || !deg.has(e.b)) continue;
      deg.set(e.a, deg.get(e.a) + 1); deg.set(e.b, deg.get(e.b) + 1);
      nbrs.get(e.a).add(e.b); nbrs.get(e.b).add(e.a);
    }
    const byId = new Map(nodes.map(n => [n.id, n]));
    const avg = nodes.length ? [...deg.values()].reduce((s, x) => s + x, 0) / nodes.length : 0;

    const surprising = [];
    for (const e of edges) {
      const a = byId.get(e.a), b = byId.get(e.b);
      if (!a || !b) continue;
      const reasons = []; let score = 0;
      if (comm.get(a.id) !== comm.get(b.id)) { score += 3; reasons.push('connects two different clusters'); }
      if ((a.type ?? '') !== (b.type ?? '')) { score += 2; reasons.push('links different kinds of notes'); }
      const lo = Math.min(deg.get(a.id), deg.get(b.id)), hi = Math.max(deg.get(a.id), deg.get(b.id));
      if (lo <= 2 && hi >= Math.max(4, avg * 2)) { score += 2; reasons.push('ties a peripheral note to a hub'); }
      if (score >= 3) surprising.push({ a: a.id, b: b.id, score, reasons });
    }
    surprising.sort((x, y) => y.score - x.score);

    const isolated = nodes.filter(n => deg.get(n.id) <= 1)
      .map(n => ({ id: n.id, degree: deg.get(n.id) })).sort((x, y) => x.degree - y.degree);

    const sizes = new Map();
    for (const c of comm.values()) sizes.set(c, (sizes.get(c) || 0) + 1);
    const sparse = [...sizes].filter(([c, s]) => s >= 3 && (coh.get(c) ?? 1) < 0.15)
      .map(([c, s]) => ({ community: c, size: s, cohesion: coh.get(c) }));

    const bridges = [];
    for (const n of nodes) {
      const seen = new Set([comm.get(n.id)]);
      for (const m of nbrs.get(n.id)) seen.add(comm.get(m));
      if (seen.size >= 3) bridges.push({ id: n.id, clusters: seen.size });
    }
    bridges.sort((x, y) => y.clusters - x.clusters);
    return { surprising: surprising.slice(0, 12), isolated, sparse, bridges: bridges.slice(0, 12) };
  }

  /* ------------------------------------------------------------ search */
  const STOP = new Set('a an and are as at be but by for if in into is it no not of on or such that the their then there these they this to was will with from have has had you your i we he she his her its our what which who how when where why can do does did about'.split(' '));
  const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/;
  function tokenize(q) {
    const out = [];
    const words = String(q).toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
    for (const w of words) {
      if (CJK.test(w)) {
        const chars = [...w];
        if (chars.length === 1) out.push(w);
        for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1]);
      } else if (!STOP.has(w) && w.length > 0) out.push(w);
    }
    return [...new Set(out)];
  }
  /** docs: {id,title,plain,tags?:string[]}[]. Title hit +10, content hits (cap 5), tag hit +3,
   *  plus a bonus for matching more distinct query terms. */
  function search(docs, query, { limit = 30 } = {}) {
    const toks = tokenize(query);
    if (!toks.length) return [];
    const res = [];
    for (const d of docs) {
      const title = d.title.toLowerCase(), text = d.plain.toLowerCase();
      let score = 0, matched = 0, first = -1;
      for (const t of toks) {
        let s = 0;
        if (title.includes(t)) s += 10;
        let pos = text.indexOf(t), c = 0;
        if (pos >= 0 && first < 0) first = pos;
        while (pos >= 0 && c < 5) { c++; pos = text.indexOf(t, pos + t.length); }
        s += c;
        if ((d.tags || []).some(x => x.toLowerCase().includes(t))) s += 3;
        if (s > 0) { matched++; score += s; }
      }
      if (!matched) continue;
      score += matched * 2;
      res.push({ id: d.id, score, snippet: snippet(d.plain, first) });
    }
    return res.sort((x, y) => y.score - x.score).slice(0, limit);
  }
  function snippet(plain, pos, len = 150) {
    const flat = plain.replace(/\s+/g, ' ').trim();
    if (pos < 0 || plain.length < len) return flat.slice(0, len);
    // positions differ slightly once whitespace is collapsed; re-find roughly
    const ratio = flat.length / Math.max(plain.length, 1);
    const start = Math.max(0, Math.floor(pos * ratio) - 40);
    return (start > 0 ? '…' : '') + flat.slice(start, start + len) + (start + len < flat.length ? '…' : '');
  }

  return { louvain, cohesion, buildContext, relevance, related, insights, tokenize, search, WEIGHTS: W };
});
