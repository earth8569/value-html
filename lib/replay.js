/* Graph replay planning: in what order should notes appear when the graph "grows"?
   Pure logic (no DOM) so it can be tested under node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HVReplay = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** nodes: {id, day: 'YYYY-MM-DD' | null, deg}[]   edges: {a, b}[]
   *  Returns {order: id[], parent: Map id -> id|null, day: Map id -> 'YYYY-MM-DD', days: string[]}.
   *  Notes appear oldest day first. Inside a day the graph grows like a plant: each step takes the note
   *  with the most links into what is already shown (ties: the bigger hub), and a note with no link into the
   *  shown graph starts a new branch from the biggest remaining hub. Notes without a date (unresolved links,
   *  tags) take the earliest day of their neighbours. `parent` is the neighbour a note grows out of. */
  function plan(nodes, edges) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    const adj = new Map(nodes.map(n => [n.id, new Set()]));
    for (const e of edges) {
      if (e.a === e.b || !adj.has(e.a) || !adj.has(e.b)) continue;
      adj.get(e.a).add(e.b); adj.get(e.b).add(e.a);
    }
    const day = new Map();
    for (const n of nodes) if (n.day) day.set(n.id, n.day);
    for (const n of nodes) {
      if (day.has(n.id)) continue;
      let best = null;
      for (const m of adj.get(n.id)) { const d = byId.get(m).day; if (d && (best === null || d < best)) best = d; }
      day.set(n.id, best || '9999-99-99');
    }
    const groups = new Map();
    for (const n of nodes) {
      const d = day.get(n.id);
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(n);
    }
    const days = [...groups.keys()].sort();
    const order = [], placed = new Set(), parent = new Map();
    for (const d of days) {
      const rest = new Set(groups.get(d));
      const links = new Map();                       // remaining note -> links into the shown graph
      for (const n of rest) { let c = 0; for (const m of adj.get(n.id)) if (placed.has(m)) c++; links.set(n.id, c); }
      while (rest.size) {
        let best = null, bl = -1, bd = -1;
        for (const n of rest) {
          const l = links.get(n.id);
          if (l > bl || (l === bl && n.deg > bd)) { best = n; bl = l; bd = n.deg; }
        }
        rest.delete(best); order.push(best.id); placed.add(best.id);
        let p = null, pd = -1;
        for (const m of adj.get(best.id)) {
          if (links.has(m)) links.set(m, links.get(m) + 1);
          if (placed.has(m) && m !== best.id && byId.get(m).deg > pd) { p = m; pd = byId.get(m).deg; }
        }
        parent.set(best.id, p);
      }
    }
    return { order, parent, day, days };
  }

  return { plan };
});
