const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/fold.js');

// blocks: 0 = paragraph, n = heading level n
//   idx: 0 p | 1 H2 A | 2 p | 3 H3 A1 | 4 p | 5 H3 A2 | 6 p | 7 H2 B | 8 p | 9 H4 B1 | 10 p
const levels = [0, 2, 0, 3, 0, 3, 0, 2, 0, 4, 0];
const none = new Array(levels.length).fill(false);
const fold = (...idx) => levels.map((_, i) => idx.includes(i));
const shown = hidden => hidden.map((h, i) => (h ? null : i)).filter(i => i !== null);

test('nothing folded: everything is visible', () => {
  assert.deepEqual(F.plan(levels, none), none);
});

test('folding a section hides its content and sub-sections up to the next heading of the same or higher level', () => {
  const hidden = F.plan(levels, fold(1));                 // fold H2 "A"
  assert.deepEqual(shown(hidden), [0, 1, 7, 8, 9, 10]);   // A's paragraph, H3s and their paragraphs are gone; B stays
});

test('folding a sub-section only hides that sub-section', () => {
  const hidden = F.plan(levels, fold(3));                 // fold H3 "A1"
  assert.deepEqual(shown(hidden), [0, 1, 2, 3, 5, 6, 7, 8, 9, 10]);
});

test('the content before the first heading (a summary) is never hidden', () => {
  const hidden = F.plan(levels, fold(1, 7));
  assert.equal(hidden[0], false);
  assert.deepEqual(shown(hidden), [0, 1, 7]);
});

test('a folded heading inside a folded parent stays harmlessly folded', () => {
  const hidden = F.plan(levels, fold(1, 3));
  assert.deepEqual(shown(hidden), [0, 1, 7, 8, 9, 10]);
  assert.deepEqual(F.plan(levels, fold(1)), hidden);       // same result as the parent alone
});

test('a deeper heading after a folded one does not end the fold, a shallower or equal one does', () => {
  const lv = [2, 0, 4, 0, 3, 0, 2, 0];
  const hidden = F.plan(lv, [true, false, false, false, false, false, false, false]);
  assert.deepEqual(shown(hidden), [0, 6, 7]);              // H4 and H3 are inside the H2; the next H2 ends it
});

test('fold-all folds the top-level sections', () => {
  assert.equal(F.foldAllLevel(levels), 2);
  assert.equal(F.foldAllLevel([1, 0, 3, 0]), 3);           // only h1 and h3: the h1 is the title, fold the h3s
  assert.equal(F.foldAllLevel([1, 0, 0]), 1);              // h1 only
  assert.equal(F.foldAllLevel([0, 0]), 0);                 // no headings: nothing to fold
});

test('fold-all then plan leaves one visible heading per section', () => {
  const L = F.foldAllLevel(levels);
  const folded = levels.map(l => l === L);
  assert.deepEqual(shown(F.plan(levels, folded)), [0, 1, 7]);
});

test('revealing finds exactly the folded ancestors that hide a block', () => {
  assert.deepEqual(F.revealing(levels, fold(1), 4), [1]);              // paragraph under A1, hidden by A
  assert.deepEqual(F.revealing(levels, fold(1, 3), 4).sort(), [1, 3]); // hidden by both A and A1
  assert.deepEqual(F.revealing(levels, fold(3), 4), [3]);
  assert.deepEqual(F.revealing(levels, fold(1), 8), []);               // B's paragraph is not under A
  assert.deepEqual(F.revealing(levels, fold(1), 1), []);               // a folded heading itself stays visible
  assert.deepEqual(F.revealing(levels, fold(1), 3), [1]);              // a sub-heading is hidden by its parent
  assert.deepEqual(F.revealing(levels, fold(3), 5), []);               // sibling sub-section is unaffected
});

test('unfolding what revealing reports makes the block visible', () => {
  for (let i = 0; i < levels.length; i++) {
    const folded = fold(1, 3, 5, 7, 9);
    const fix = F.revealing(levels, folded, i);
    const after = folded.map((f, j) => f && !fix.includes(j));
    assert.equal(F.plan(levels, after)[i], false, 'block ' + i);
  }
});

test('reading stats', () => {
  assert.deepEqual(F.readingStats(''), { words: 0, minutes: 1 });
  assert.equal(F.readingStats('one two three').words, 3);
  assert.equal(F.readingStats('word '.repeat(2300)).minutes, 10);
  assert.equal(F.readingStats('naïve café 12 345').words, 4);
});
