# Value HTML

An Obsidian-style graph notebook for Windows that stores **every note as a real, human-readable `.html` file**.
Open a folder, write with a rich editor, link notes with `[[wikilinks]]`, and explore them as a graph.
It is a desktop app (Electron); the same `index.html` also runs in Chrome/Edge as a web app.

## Features

**Notes as HTML**
- Each note is a standalone `.html` file with its own styling and relative `<a href>` links, so it opens in any browser
- Rich content survives: headings, tables, callouts, checklists, highlights, text colour, pasted images
- Tags live in `<meta name="hv:tags">` (and inline `#tags`); rename a note and every link to it updates

**Graph**
- Force-directed graph: drag, zoom, hover to highlight, click to open; local graph, tag nodes, ghost nodes for unresolved links
- **Color groups**: a query plus a color (`tag:#idea`, `path:Projects`, `file:name`), shown in the graph, the file list and a legend; optional *Separate groups into clusters*
- **Auto communities**: Louvain community detection colors the graph by discovered clusters, with a cohesion score per cluster
- **Insights**: surprising cross-cluster links, isolated notes, sparse clusters and bridge notes, each highlightable in the graph
- **Related notes** in the sidebar, ranked by direct links, shared tags, common neighbours (Adamic-Adar) and same folder

**Desktop app**
- Native folder access with a file watcher (edit files outside the app and it reloads), atomic saves, reopens your last vault
- Full-text search (`Ctrl+Shift+F`) with title and tag boosting and snippets
- **Import Markdown / Obsidian folders** (frontmatter tags, wikilinks, tables, tasks, callouts)
- **Ask your notes** (`Ctrl+L`): chat with any OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio, OpenRouter...). Retrieval uses search + the link graph, answers cite notes as `[1]`, and "Save as note" turns an answer into a linked note. The API key is encrypted with the OS and kept in the main process
- **Local read-only API** for AI agents on `127.0.0.1` (token protected): `/api/v1/health`, `/notes`, `/notes/content?path=`, `/graph`, `/related?path=`, `POST /search`

## Run

```bash
npm install
npm start            # run the desktop app
npm test             # unit tests for graph analysis and the Markdown converter
npm run dist         # build dist/Value HTML-Setup-<ver>.exe and the portable .exe
```

Or open `index.html` in Chrome/Edge for the web version (no AI chat / API / file watching).

## Layout

```
main.js        Electron main process: window, sandboxed file IPC, watcher, LLM streaming, local API
preload.js     the only bridge between the page and the main process
index.html     the app (UI, editor, graph)
features.js    search, insights, related notes, AI chat, settings, import, API handler
lib/analysis.js  Louvain, cohesion, relevance, insights, search (pure, tested)
lib/md.js        Markdown -> HTML converter (pure, tested)
```

## Security notes
- The page runs sandboxed with no Node access; file access is limited to vault folders you picked
- Notes loaded from disk are sanitised (scripts, event handlers and `javascript:` URLs stripped) and a Content Security Policy blocks remote requests from the page
- The local API binds to `127.0.0.1`, requires a bearer token and checks the `Host` header

## Credits
Feature ideas (community detection, graph insights, relevance-ranked retrieval, citations) were inspired by
[nashsu/llm_wiki](https://github.com/nashsu/llm_wiki), a GPL-3.0 project. This repository contains no code from it.
