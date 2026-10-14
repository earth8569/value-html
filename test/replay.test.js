const test = require('node:test');
const assert = require('node:assert/strict');
const { plan } = require('../lib/replay.js');

const n = (id, day, deg = 0) => ({ id, day, deg });
const e = (a, b) => ({ a, b });

test('older days appear first and every note appears exactly once', () => {
  const nodes = [n('c', '2026-10-12', 1), n('a', '2026-10-04', 2), n('b', '2026-10-08', 1)];
  const r = plan(nodes, [e('a', 'b'), e('a', 'c')]);
  assert.deepEqual(r.order, ['a', 'b', 'c']);
  assert.deepEqual(r.days, ['2026-10-04', '2026-10-08', '2026-10-12']);
  assert.equal(new Set(r.order).size, nodes.length);
});

test('within a day the graph grows outward from the biggest hub', () => {
  // star around hub h, plus a separate pair x-y with a bigger-looking leaf
  const day = '2026-10-10';
  const nodes = [n('l1', day, 1), n('l2', day, 1), n('h', day, 3), n('l3', day, 1), n('x', day, 1), n('y', day, 1)];
  const r = plan(nodes, [e('h', 'l1'), e('h', 'l2'), e('h', 'l3'), e('x', 'y')]);
  assert.equal(r.order[0], 'h');                            // seed = biggest hub
  assert.deepEqual(new Set(r.order.slice(1, 4)), new Set(['l1', 'l2', 'l3']));   // its leaves attach before the unrelated pair
  for (const id of ['l1', 'l2', 'l3']) assert.equal(r.parent.get(id), 'h');
  assert.equal(r.parent.get('h'), null);
});

test('a note links to something already shown whenever it can', () => {
  const day = '2026-10-10';
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const nodes = ids.map((id, i) => n(id, day, i + 1));
  const edges = [e('a', 'b'), e('b', 'c'), e('c', 'd'), e('d', 'e')];     // a path: must be walked, not scattered
  const r = plan(nodes, edges);
  const seen = new Set();
  r.order.forEach((id, i) => {
    if (i > 0) assert.ok(r.parent.get(id) !== null && seen.has(r.parent.get(id)), id + ' should grow out of a shown note');
    seen.add(id);
  });
});

test('undated notes (ghosts, tags) take the earliest day of their neighbours', () => {
  const nodes = [n('a', '2026-10-05', 1), n('b', '2026-10-09', 1), n('ghost', null, 2), n('lonely', null, 0)];
  const r = plan(nodes, [e('ghost', 'a'), e('ghost', 'b')]);
  assert.equal(r.day.get('ghost'), '2026-10-05');
  assert.equal(r.day.get('lonely'), '9999-99-99');           // no neighbours: shown last
  assert.equal(r.order[r.order.length - 1], 'lonely');
  assert.ok(r.order.indexOf('ghost') < r.order.indexOf('b'));
});

test('empty and single-node graphs are fine', () => {
  assert.deepEqual(plan([], []).order, []);
  assert.deepEqual(plan([n('a', '2026-10-05')], []).order, ['a']);
});

test('parents always come earlier in the order', () => {
  const nodes = [];
  const edges = [];
  for (let i = 0; i < 60; i++) { nodes.push(n('n' + i, '2026-10-' + String(4 + (i % 5)).padStart(2, '0'), (i % 7) + 1)); if (i) edges.push(e('n' + i, 'n' + Math.floor(Math.random() * i))); }
  const r = plan(nodes, edges);
  const idx = new Map(r.order.map((id, i) => [id, i]));
  for (const [id, p] of r.parent) if (p !== null) assert.ok(idx.get(p) < idx.get(id));
  assert.equal(r.order.length, 60);
});
