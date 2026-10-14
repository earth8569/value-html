const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../lib/analysis.js');
const MD = require('../lib/md.js');

// two dense triangles joined by one bridge edge, plus an orphan
const ids = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'solo'];
const edges = [['a1', 'a2'], ['a2', 'a3'], ['a1', 'a3'], ['b1', 'b2'], ['b2', 'b3'], ['b1', 'b3'], ['a3', 'b1']]
  .map(([a, b]) => ({ a, b }));

test('louvain finds the two clusters and leaves the orphan alone', () => {
  const c = A.louvain(ids, edges);
  assert.equal(c.get('a1'), c.get('a2'));
  assert.equal(c.get('a2'), c.get('a3'));
  assert.equal(c.get('b1'), c.get('b2'));
  assert.equal(c.get('b2'), c.get('b3'));
  assert.notEqual(c.get('a1'), c.get('b1'));
  assert.notEqual(c.get('solo'), c.get('a1'));
  assert.notEqual(c.get('solo'), c.get('b1'));
});

test('louvain with no edges gives every node its own community', () => {
  const c = A.louvain(['x', 'y', 'z'], []);
  assert.equal(new Set(c.values()).size, 3);
});

test('cohesion is 1 for a clique and low for a loose cluster', () => {
  const comm = new Map([['a', 0], ['b', 0], ['c', 0], ['d', 1], ['e', 1], ['f', 1], ['g', 1]]);
  const e = [{ a: 'a', b: 'b' }, { a: 'b', b: 'c' }, { a: 'a', b: 'c' }, { a: 'd', b: 'e' }];
  const coh = A.cohesion(comm, e);
  assert.equal(coh.get(0), 1);
  assert.ok(coh.get(1) < 0.2);
});

test('relevance weighs direct links, shared tags and common neighbours', () => {
  const nodes = [
    { id: 'p', tags: ['x'], type: 'n' }, { id: 'q', tags: ['x'], type: 'n' },
    { id: 'r', tags: [], type: 'n' }, { id: 's', tags: [], type: 'n' }, { id: 'hub', tags: [], type: 'n' },
  ];
  const ctx = A.buildContext(nodes, [{ a: 'p', b: 'q' }, { a: 'p', b: 'hub' }, { a: 'r', b: 'hub' }, { a: 'hub', b: 's' }]);
  const pq = A.relevance('p', 'q', ctx);
  assert.equal(pq.signals.direct, 1);
  assert.equal(pq.signals.sharedTags, 1);
  assert.equal(pq.score, 3 + 4 + 1); // direct + tag + same-type
  const pr = A.relevance('p', 'r', ctx); // only a common neighbour
  assert.ok(pr.signals.adamicAdar > 0 && pr.score > 0 && pr.score < pq.score);
  const rel = A.related('p', ctx, 3);
  assert.equal(rel[0].id, 'q');
});

test('insights flag isolated notes, bridges and surprising cross-cluster links', () => {
  const nodes = ids.map(id => ({ id, label: id, type: id[0] }));
  const comm = A.louvain(ids, edges);
  const coh = A.cohesion(comm, edges);
  const ins = A.insights(nodes, edges, comm, coh);
  assert.ok(ins.isolated.some(x => x.id === 'solo'));
  assert.ok(ins.surprising.some(x => (x.a === 'a3' && x.b === 'b1')));
  // a bridge needs neighbours in 3+ clusters
  const nodes2 = [...nodes, ...['c1', 'c2', 'c3', 'x'].map(id => ({ id, label: id, type: 'c' }))];
  const e2 = [...edges, { a: 'c1', b: 'c2' }, { a: 'c2', b: 'c3' }, { a: 'c1', b: 'c3' },
    { a: 'x', b: 'a1' }, { a: 'x', b: 'b1' }, { a: 'x', b: 'c1' }];
  const ids2 = nodes2.map(n => n.id), comm2 = A.louvain(ids2, e2);
  const ins2 = A.insights(nodes2, e2, comm2, A.cohesion(comm2, e2));
  assert.ok(ins2.bridges.some(b => b.id === 'x' && b.clusters >= 3));
});

test('search ranks title hits first and builds snippets', () => {
  const docs = [
    { id: 1, title: 'Graph theory', plain: 'Nodes and edges. '.repeat(10), tags: [] },
    { id: 2, title: 'Gardening', plain: 'The graph of my tomato growth over the season, with a long tail of text here.', tags: [] },
    { id: 3, title: 'Cooking', plain: 'Pasta and sauce', tags: ['food'] },
  ];
  const r = A.search(docs, 'graph');
  assert.equal(r[0].id, 1);
  assert.equal(r[1].id, 2);
  assert.ok(r[1].snippet.toLowerCase().includes('graph'));
  assert.equal(A.search(docs, 'the of and').length, 0); // stop words only
  assert.equal(A.search(docs, 'food')[0].id, 3); // tag hit
});

test('search tokenizes CJK as bigrams', () => {
  assert.deepEqual(A.tokenize('知识库'), ['知识', '识库']);
  const r = A.search([{ id: 1, title: 'x', plain: '我的知识库笔记', tags: [] }], '知识');
  assert.equal(r.length, 1);
});

test('markdown converts blocks and inline syntax', () => {
  const html = MD.toHtml('# Title\n\nSome **bold**, *it*, ==hi== and `code <b>`.\n\n- one\n  - nested\n- [x] done\n\n> [!note] Heads up\n> body\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x = 1 < 2;\n```');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<mark>hi<\/mark>/);
  assert.match(html, /<code>code &lt;b&gt;<\/code>/);
  assert.match(html, /<ul><li>one<ul><li>nested<\/li><\/ul><\/li><li><input type="checkbox" checked> done<\/li><\/ul>/);
  assert.match(html, /class="callout"><p><strong>Heads up<\/strong>/);
  assert.match(html, /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td>/);
  assert.match(html, /<pre><code>let x = 1 &lt; 2;<\/code><\/pre>/);
});

test('markdown wikilinks, aliases, headings and folders', () => {
  const html = MD.inline('See [[Folder/Other Note#Part|that]] and [[Plain]] and ![[Embed.md]].');
  assert.match(html, /data-link="Other Note" href="">that<\/a>/);
  assert.match(html, /data-link="Plain" href="">Plain<\/a>/);
  assert.match(html, /data-link="Embed" /);
});

test('markdown does not format inside code and escapes html', () => {
  assert.equal(MD.inline('`**x**` <script>'), '<code>**x**</code> &lt;script&gt;');
});

test('looksSensitive flags credential notes without flagging normal ones', () => {
  assert.ok(MD.looksSensitive('OKX-API-Credentials-and-Bot-Algo', 'x'));
  assert.ok(MD.looksSensitive('Notes', 'api_key = abcdefghijklmnop1234'));
  assert.ok(MD.looksSensitive('Runbook', 'OKX_API_KEY = abcdefghijklmno\nOKX_API_PASSPHRASE = abcdefghijklmn'));
  assert.ok(MD.looksSensitive('Notes', 'token: "ghp_' + 'a'.repeat(36) + '"'));
  assert.ok(MD.looksSensitive('Notes', '-----BEGIN RSA PRIVATE KEY-----'));
  assert.ok(!MD.looksSensitive('Pasta', 'Mix the flour. Tokenomics of the coin is a topic. key = short'));
  assert.ok(!MD.looksSensitive('Strategy', 'backtest id 3f2a9c1e-77b0-4d1a-9a52 for the run'));
});

test('frontmatter tags in list, inline and csv forms', () => {
  assert.deepEqual(MD.frontmatter('---\ntags:\n  - a\n  - "#b"\n---\nbody').tags, ['a', 'b']);
  assert.deepEqual(MD.frontmatter('---\ntags: [x, y]\n---\nbody').tags, ['x', 'y']);
  assert.equal(MD.frontmatter('---\ntitle: T\n---\nbody').body, 'body');
  assert.equal(MD.frontmatter('no front').body, 'no front');
});
