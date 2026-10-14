/* Section folding and reading stats. Pure logic (no DOM) so it can be tested under node.
   A note is a flat list of blocks; levels[i] is 1-4 when block i is a heading, otherwise 0. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HVFold = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Which blocks are hidden? A folded heading hides everything after it up to the next heading of the same
   *  or a higher level (a smaller number), so sub-sections fold along with their parent. */
  function plan(levels, folded) {
    const hidden = new Array(levels.length).fill(false);
    let foldLevel = 0;
    for (let i = 0; i < levels.length; i++) {
      const l = levels[i];
      if (foldLevel) {
        if (l && l <= foldLevel) foldLevel = 0;
        else { hidden[i] = true; continue; }
      }
      if (l && folded[i]) foldLevel = l;
    }
    return hidden;
  }

  /** Which heading level should "Fold all" fold? The top-level sections: the smallest level among h2-h4,
   *  or h1 when that is all there is. 0 means nothing can be folded. */
  function foldAllLevel(levels) {
    const sub = levels.filter(l => l >= 2);
    if (sub.length) return Math.min(...sub);
    return levels.some(l => l === 1) ? 1 : 0;
  }

  /** Which folded headings are hiding block i? (They must be unfolded for i to become visible.)
   *  Heading j hides i when j is folded and every heading between j and i is deeper than j. */
  function revealing(levels, folded, i) {
    const out = [];
    let minBetween = levels[i] || Infinity;     // a heading hides itself only through a shallower, folded ancestor
    for (let j = i - 1; j >= 0; j--) {
      const l = levels[j];
      if (!l) continue;
      if (l < minBetween && folded[j]) out.push(j);
      minBetween = Math.min(minBetween, l);
    }
    return out;
  }

  /** Word count and an estimated reading time (230 words per minute, at least 1 minute). */
  function readingStats(text) {
    const words = (String(text).match(/[\p{L}\p{N}]+/gu) || []).length;
    return { words, minutes: Math.max(1, Math.round(words / 230)) };
  }

  return { plan, foldAllLevel, revealing, readingStats };
});
