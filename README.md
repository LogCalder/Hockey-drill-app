# Hockey Drill Designer

Client-side tool for drawing ice hockey drills and exporting them as Letter-size PDFs.
No build step, no server: open `index.html` in Chrome, or serve the folder with GitHub Pages
(Settings → Pages → Deploy from branch → `main` / root).

## Use
- **Drag** players, puck, cone or stick from the left panel onto the ice (double-click also drops one).
- **Tools** (left): Skate `F`, Backward `B`, Pass `P`, Shot `S`, Text `T`, Select `V`. `Straight`/`Curve` (`C`) picks the line type.
  Curve lines have a white middle handle - drag it to bend the path. Drag any handle of a selected line to adjust it.
- `⌫` delete, `R` rotate cone/stick, `⌘D` duplicate, `⌘Z` / `⇧⌘Z` undo/redo, arrows nudge, `⌘S` save.
- **Pen** (`D`): draw freehand on the ice. **Coach**: the © piece in Equipment (it can skate like a player).
- **Animate** (top bar): select a motion line, set its **Step**, and click **Pick on the ice** to attach pieces.
  Skating/backward lines move players or the coach (and a puck they carry); passes and shots attach to a puck only and
  fire when the puck's carrier reaches the start of the pass/shot. Same step = same time; steps play in order.
  The **Steps** panel (top of the right column) lists every step in plain words and highlights the current one while playing; click a step to jump to it.
  Each motion has its own **Speed** slider. Use the play bar to play, scrub and change speed. Previews never change your drill. **Export video** (top bar or play bar) records the animation as an MP4 (WebM if the browser can't do MP4) into the Exports folder;
  it records in real time, so a 10 s drill takes about 12 s. The PDF export can include the step list as text.
- **Folder saving (Chrome):** two independent folders, each picked once from the top bar and remembered.
  **Drills folder**: every drill auto-saves there as its own `<name>.drill.json`. **Exports folder**: PDFs are saved there
  (the first export asks you to pick it; cancel to get a normal download instead). They can be the project's `Drills/` and
  `Exports/` folders (contents gitignored) or anywhere else. Chrome asks you to click **Reconnect** once per browser session.
  **Open…** adds drills from the Drills folder; "Import file…" reads any `.json`. Work also autosaves in the browser as a fallback.
  **The app never deletes or moves files in your folders**, and it won't overwrite a file that belongs to a different drill
  (it saves as `name (2)` instead). Renaming a drill leaves the old file behind; delete old files yourself in Finder.
  It also reads a `Drills` subfolder inside your drills folder (created by an early version of the app).
- **Export PDF**: 1, 2 or 4 drills per page, one drill or all (extra pages are added automatically).
  Drills on a page share one scale, so pieces stay the same size.

## Layout
- `js/rink.js` - vector rink backgrounds (half = lower half of the full rink)
- `js/render.js` - drawing + hit-testing for every piece / line type
- `js/fs.js` - folder saving (File System Access API)
- `js/anim.js` - animation timeline + playback
- `js/store.js` - project data, undo/redo, autosave
- `js/editor.js` - canvas interaction
- `js/export.js` - PDF (bundled jsPDF in `js/lib/`, so it works offline)
- `js/main.js`, `css/style.css`, `index.html` - UI

Scripts are classic `<script>` tags (not ES modules) so the app also runs from `file://`.
