/* Small Markdown -> HTML converter for importing Obsidian-style vaults and rendering chat answers.
   Supports: frontmatter tags, headings, lists (nested, tasks), code fences, quotes, tables, hr,
   bold/italic/strike/highlight, links, images, [[wikilinks]] (+alias, #heading, folders). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HVMD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

  function frontmatter(md) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
    if (!m) return { meta: {}, body: md, tags: [] };
    const meta = {};
    let key = null;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (kv) { key = kv[1].toLowerCase(); meta[key] = kv[2].trim(); if (meta[key] === '') meta[key] = []; }
      else if (key && /^\s*-\s+/.test(line)) { if (!Array.isArray(meta[key])) meta[key] = []; meta[key].push(line.replace(/^\s*-\s+/, '').trim()); }
    }
    let tags = meta.tags ?? meta.tag ?? [];
    if (typeof tags === 'string') tags = tags.replace(/^\[|\]$/g, '').split(/[,\s]+/);
    tags = tags.map(t => String(t).trim().replace(/^["']|["']$/g, '').replace(/^#/, '').trim()).filter(Boolean);
    return { meta, body: md.slice(m[0].length), tags };
  }

  function wikiTarget(raw) {
    let t = raw.split('|')[0].split('#')[0].split('^')[0].trim();
    t = t.split('/').pop();
    return t.replace(/\.(md|html?)$/i, '');
  }

  function inline(src) {
    const stash = [];
    const hold = h => '\u0000' + (stash.push(h) - 1) + '\u0000';
    let s = src.replace(/`([^`]+)`/g, (m, c) => hold('<code>' + esc(c) + '</code>'));
    s = esc(s);
    s = s.replace(/!?\[\[([^\]]+?)\]\]/g, (m, inner) => {
      const [target, alias] = inner.split('|');
      const name = unesc(wikiTarget(target));
      if (!name) return m;
      return hold(`<a class="wikilink" data-link="${esc(name)}" href="">${(alias || target.split('#')[0].split('/').pop() || name).trim()}</a>`);
    });
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, alt, src2) => hold(`<img alt="${alt}" src="${src2}">`));
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, t, u) => hold(`<a href="${u}">${t}</a>`));
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?![_\w])/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/==([^=]+)==/g, '<mark>$1</mark>');
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[+i]);
  }

  function toHtml(md) {
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    const isTable = (a, b) => /\|/.test(a) && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(b || '');
    const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m;
      if ((m = /^(\s*)(```|~~~)\s*([\w+-]*)/.exec(line))) {
        const fence = m[2], buf = []; i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
        i++;
        out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      } else if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
        out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++;
      } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        out.push('<hr>'); i++;
      } else if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        const first = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(buf[0] || '');
        if (first) {
          const title = first[2] || first[1][0].toUpperCase() + first[1].slice(1).toLowerCase();
          out.push(`<div class="callout"><p><strong>${esc(title)}</strong></p>${toHtml(buf.slice(1).join('\n'))}</div>`);
        } else out.push(`<blockquote>${toHtml(buf.join('\n'))}</blockquote>`);
      } else if (isTable(line, lines[i + 1])) {
        const head = cells(line); i += 2;
        const rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push('<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + head.map((_, k) => `<td>${inline(r[k] || '')}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      } else if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        const items = [];
        while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length))) {
          const lm = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
          if (lm) items.push({ indent: lm[1].replace(/\t/g, '    ').length, ordered: /\d/.test(lm[2]), text: lm[3] });
          else items[items.length - 1].text += ' ' + lines[i].trim();
          i++;
        }
        out.push(renderList(items));
      } else {
        const buf = [];
        while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*>|\s*(```|~~~)|\s*([-*+]|\d+[.)])\s+)/.test(lines[i]) && !isTable(lines[i], lines[i + 1])) buf.push(lines[i++].trim());
        if (!buf.length) { buf.push(lines[i++]); }
        out.push(`<p>${inline(buf.join(' '))}</p>`);
      }
    }
    return out.join('\n');
  }

  function renderList(items) {
    let html = '';
    const stack = []; // {indent, tag}
    const open = (it) => { const tag = it.ordered ? 'ol' : 'ul'; html += `<${tag}>`; stack.push({ indent: it.indent, tag, liOpen: false }); };
    for (const it of items) {
      while (stack.length && it.indent < stack[stack.length - 1].indent) {
        const t = stack.pop(); html += (t.liOpen ? '</li>' : '') + `</${t.tag}>`;
      }
      if (!stack.length || it.indent > stack[stack.length - 1].indent) open(it);
      else if (stack[stack.length - 1].liOpen) { html += '</li>'; stack[stack.length - 1].liOpen = false; }
      const task = /^\[([ xX])\]\s+(.*)$/.exec(it.text);
      html += '<li>' + (task ? `<input type="checkbox"${task[1] !== ' ' ? ' checked' : ''}> ${inline(task[2])}` : inline(it.text));
      stack[stack.length - 1].liOpen = true;
    }
    while (stack.length) { const t = stack.pop(); html += (t.liOpen ? '</li>' : '') + `</${t.tag}>`; }
    return html;
  }

  return { toHtml, inline, frontmatter, wikiTarget };
});
