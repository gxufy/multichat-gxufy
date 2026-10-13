/* The Classic generator's design system.
 *
 * Lifted from the original page essentially verbatim â€” the same custom
 * properties, the same charcoal cards with chunky shadows, the same single
 * #4a84fa accent, the same pill switches, the same 900px column â€” because that
 * palette *is* the product's look and the revamp is meant to keep it.
 *
 * What is new here is layout and the accessibility work the inline version never
 * had:
 *
 *   - `.tool-grid` places the two tools into a column each on a desktop â€” outputs
 *     aligned in row one, each settings card beneath its own output in row two â€”
 *     while leaving DOM order alone. Order is the stacked order (chat output, chat
 *     settings, counter output, counter settings), so a phone reads each tool as a
 *     unit and the desktop arrangement is named grid areas rather than a second
 *     tree.
 *   - Focus is visible on every control, including the pill switches whose real
 *     checkbox is visually hidden â€” the ring is drawn on the slider from the
 *     input's :focus-visible.
 *   - A skip link, `.sr-only`, and reduced-motion handling.
 *
 * Kept as a string in a module rather than a global stylesheet because it is
 * scoped to this one route by being emitted with it, and because the original
 * page's `html, body` rules must not apply to the overlay routes.
 */

export const CLASSIC_GENERATOR_CSS = `

*, *::before, *::after { box-sizing: border-box; }
:root {
  --bg: #141418;
  --card: #1d1d23;
  --card-2: #24242c;
  --line: #2c2c35;
  --text: #e2e2e8;
  --muted: #9a9aa5;
  --dim: #62626e;
  --accent: #4a84fa;
  --accent-2: #6d9dff;
  --warn: #e0a34a;
  --err: #ee7777;
  --ok: #2fbf71;
  --settings-control-gap: 3px;
  --settings-group-gap: 8px;
  --shadow: 0 4px 24px rgba(0,0,0,.45), 0 1px 3px rgba(0,0,0,.5);
}
html, body {
  margin: 0; padding: 0; background: var(--bg); color: var(--text);
  font-family: 'Montserrat', 'Noto Sans JP', system-ui, sans-serif; font-size: 16px;
}
body { background-image: radial-gradient(ellipse 900px 420px at 50% -80px, rgba(74,132,250,0.09), transparent); }
a { color: var(--accent); text-decoration: none; transition: opacity .2s; }
a:hover { color: var(--accent-2); opacity: .85; }

/* The centred column. Wider than the original 900px because two tool panels sit
   side by side now; the panels themselves keep the original card proportions.

   1500px with a 32px gutter: at 1920 that leaves ~210px of background either
   side, which reads as a deliberately bounded page rather than the wide empty
   gutters the 1180px column produced, and it stops well short of edge-to-edge.
   The gutter is what holds the bound at intermediate widths â€” between about 1530
   and 1560 the max-width stops binding and the padding takes over, so the page
   never touches the viewport edge. */
.page { max-width: 1500px; margin: 0 auto; padding: 0 32px 44px; }

/* Focus, visible everywhere. The original page relied on the UA default, which
   several of its controls suppressed. */
:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }

.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.skip-link {
  position: absolute; left: -9999px; top: 0; z-index: 60;
  background: var(--card); color: var(--text); font-size: 0.9rem; font-weight: 700;
  padding: 10px 16px; border: 1px solid var(--accent); border-radius: 0 0 10px 0;
}
.skip-link:focus { left: 0; }
main:focus { outline: none; }

/* Header â€” compact horizontal strip, no giant hero */
header.header-strip { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 20px; padding: 10px 0 16px; margin-bottom: 18px; position: relative; }
.home-link { font-size: 0.82rem; color: var(--muted); font-weight: 600; display: inline-flex; align-items: center; gap: 4px; padding: 4px 12px; border-radius: 8px; transition: all .15s; }
.home-link:hover { color: var(--accent); background: rgba(74,132,250,.08); }
header.header-strip::after { content: ''; position: absolute; bottom: 0; left: 15%; right: 15%; height: 2px; background: linear-gradient(90deg, transparent, var(--accent), transparent); }
.header-logo { height: 150px; width: auto; margin: -20px 0 -30px; filter: drop-shadow(0 8px 20px rgba(0,0,0,.5)); }
.header-copy { display: flex; flex-direction: column; gap: 4px; }
.header-title { font-size: 2rem; font-weight: 800; color: #fff; margin: 0; letter-spacing: -.04em; }
.header-sub { font-size: 0.9rem; font-weight: 600; color: var(--accent); margin: 0; }
.platform-row { display: flex; gap: 6px; margin-top: 2px; }
.platform-chip { font-size: 0.64rem; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; padding: 2px 10px; border-radius: 999px; background: rgba(255,255,255,0.03); }

/* Cards â€” every section is one. Padding and margins are tighter than the
   original: the page is now four panels plus two full-width sections rather than
   one column, so per-card padding is paid six times over and was pushing the
   commands and setup cards below two screens on a 1080p display. */
.card {
  background: var(--card); border: 1px solid var(--line); border-radius: 14px;
  padding: 14px 16px; margin-bottom: 14px; box-shadow: var(--shadow);
}
.card.hero { border-top: 2px solid var(--accent); padding: 16px 18px 12px; }
.section-title { font-size: 0.8rem; color: var(--accent); font-weight: 700; margin: 0 0 9px; text-transform: uppercase; letter-spacing: .12em; display: flex; align-items: center; gap: 8px; }
.section-title::before { content: ''; width: 4px; height: 14px; border-radius: 2px; background: var(--accent); }
.settings-panel-head { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:9px; }
.settings-panel-head .section-title { margin:0; }
.settings-reset-btn { white-space:normal; text-align:center; max-width:100%; }
.card-note { color: var(--dim); font-size: 0.76rem; margin: 6px 0 0; line-height: 1.45; }

/* Two-tool layout. The DOM order is also the narrow-screen order, while named
   areas align each output above its own settings on desktop. */
.tool-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas:
    "chat-output"
    "chat-settings"
    "counter-output"
    "counter-settings"
    "commands"
    "obs";
  gap: 0;
}
.panel-chat-output { grid-area: chat-output; min-width: 0; }
.panel-chat-settings { grid-area: chat-settings; min-width: 0; }
.panel-counter-output { grid-area: counter-output; min-width: 0; }
.panel-counter-settings { grid-area: counter-settings; min-width: 0; }
.panel-commands { grid-area: commands; min-width: 0; }
.panel-obs { grid-area: obs; min-width: 0; }

@media (min-width: 1000px) {
  .tool-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas:
      "chat-output counter-output"
      "chat-settings counter-settings"
      "commands commands"
      "obs obs";
    column-gap: 18px;
  }
}

/* Compact Preview Data / Live Overlay switch within the Chat output card. */
.preview-content-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.preview-content-title { color: var(--accent); font-size: .8rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 3px; text-transform: uppercase; display: flex; align-items: center; gap: 8px; }
.preview-content-title::before { content: ''; width: 4px; height: 14px; border-radius: 2px; background: var(--accent); }
.preview-content-head .preview-badge { flex: 0 0 auto; }
.preview-mode-tabs { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 7px; }
.preview-mode-tab {
  appearance: none; border: 1px solid var(--line); border-radius: 7px; background: transparent;
  color: var(--muted); cursor: pointer; font: 700 .72rem/1.2 inherit; padding: 5px 10px;
  transition: color .15s, background .15s, border-color .15s;
}
.preview-mode-tab:hover { color: var(--text); background: rgba(255,255,255,.04); }
.preview-mode-tab.active { color: #fff; border-color: rgba(74,132,250,.5); background: var(--accent); }
.preview-mode-tab:disabled { opacity: .4; cursor: not-allowed; }
.preview-mode-label { color: var(--dim); font-size: .68rem; font-weight: 700; letter-spacing: .04em; margin: 0 0 7px; text-transform: uppercase; }
.preview-data-controls { min-width: 0; }
.preview-primary-actions { display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; margin-top: 3px; }
.preview-data-controls-compact { display: grid; gap: 4px; }
.preview-roster-actions { justify-content: flex-start; min-height: 0; }
.preview-roster-status { flex: 0 1 auto; margin: 0; color: var(--dim); font-size: .68rem; line-height: 1.25; }
.preview-data-controls-compact .preview-bg { margin-top: 0; }

/* Platform inputs â€” compact row, one per platform */
.platform-inputs { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
.platform-input { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; min-width: 190px; }
.platform-input input[type=text] { max-width: none; font-size: 0.9rem; padding: 8px 12px; width: 100%; }
.channel-autocomplete { position: relative; width: 100%; }
.channel-suggestions {
  position: absolute; z-index: 50; top: calc(100% + 5px); left: 0; width: 100%;
  max-height: 286px; overflow-y: auto; padding: 4px;
  border: 1px solid #383844; border-radius: 9px; background: #18181e;
  box-shadow: 0 12px 32px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.45);
}
.channel-suggestion {
  display: grid; grid-template-columns: 38px minmax(0, 1fr); align-items: center; gap: 9px;
  width: 100%; min-width: 0; padding: 7px; border: 0; border-radius: 6px;
  color: var(--text); background: transparent; font: inherit; text-align: left; cursor: pointer;
}
.channel-suggestion:hover,
.channel-suggestion[aria-selected=true] { background: rgba(145,70,255,.18); }
.channel-autocomplete[data-platform=youtube] .channel-suggestion:hover,
.channel-autocomplete[data-platform=youtube] .channel-suggestion[aria-selected=true] { background: rgba(255,68,68,.16); }
.channel-autocomplete[data-platform=tiktok] .channel-suggestion:hover,
.channel-autocomplete[data-platform=tiktok] .channel-suggestion[aria-selected=true] { background: rgba(37,244,238,.14); }
.channel-suggestion-avatar { width: 38px; height: 38px; border-radius: 50%; object-fit: cover; background: var(--card-2); }
.channel-suggestion-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.channel-suggestion-title { min-width: 0; display: flex; align-items: center; gap: 6px; }
.channel-suggestion-display-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .82rem; font-weight: 750; }
.channel-suggestion-live { flex: 0 0 auto; padding: 1px 4px; border-radius: 3px; color: #fff; background: #e91916; font-size: .56rem; font-weight: 900; letter-spacing: .04em; }
.channel-suggestion-meta { min-width: 0; display: flex; gap: 7px; color: var(--dim); font-size: .66rem; }
.channel-suggestion-meta span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.channel-suggestion-meta span:last-child { color: var(--muted); }
.platform-tag { font-size: 0.66rem; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; padding: 2px 10px; border-radius: 999px; }
.kick-tag { color: #53fc18; border: 1px solid rgba(83,252,24,.55); background: rgba(83,252,24,.06); }
.tw-tag { color: #a970ff; border: 1px solid rgba(145,70,255,.55); background: rgba(145,70,255,.07); }
.yt-tag { color: #ff5b5b; border: 1px solid rgba(255,68,68,.55); background: rgba(255,68,68,.06); }
.tt-tag { color: #25F4EE; border: 1px solid rgba(37,244,238,.5); background: rgba(37,244,238,.05); }

/* Multi-column control table â€” the Classic arrangement, tightened.
   Grid rather than flex so a third column can be added by class alone, and so
   the dividers fall between columns without a :first-child rule per count. */
.form_table {
  display: grid; grid-template-columns: 1fr; gap: var(--settings-group-gap) 14px; margin-bottom: 6px;
  background: var(--card-2); border: 1px solid var(--line); border-radius: 10px;
  padding: 9px 12px 6px;
}
.form_col { min-width: 0; }
.form_row { display: flex; align-items: center; margin-bottom: 4px; gap: 10px; }
.form_row.left { justify-content: space-between; }
.col-heading { font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: var(--dim); margin: 0 0 7px; }
.settings-group-heading { margin: 0; }
.settings-group-toggle {
  appearance: none; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; min-height: 24px; margin: 0 0 5px; padding: 0 2px 4px;
  border: 0; border-bottom: 1px solid transparent; background: transparent; color: var(--dim);
  font: inherit; letter-spacing: inherit; text-align: left; text-transform: inherit; cursor: pointer;
  transition: color .15s, border-color .15s, background .15s;
}
.settings-group-toggle:hover { color: var(--text); border-bottom-color: var(--line); }
.settings-group-toggle:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; border-radius: 4px; }
.settings-group[data-collapsed=false] > .settings-group-heading .settings-group-toggle { color: var(--muted); }
.settings-group[data-collapsed=true] > .settings-group-heading .settings-group-toggle { margin-bottom: 0; }
.settings-group-chevron {
  flex: 0 0 auto; color: var(--accent); font-size: 1rem; line-height: 1;
  transform: rotate(0deg); transition: transform .15s ease;
}
.settings-group-toggle[aria-expanded=true] .settings-group-chevron { transform: rotate(90deg); }
.settings-group-body {
  display: flex; flex-direction: column; gap: var(--settings-control-gap);
  min-width: 0;
}
.settings-group-body[hidden] { display: none; }
.settings-group-wide { grid-column: 1 / -1; }
.text-settings-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px 14px; }
.settings-filter-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0 14px; }

/* Column counts, applied only where there is room for them. Every table is a
   single column below the breakpoint, which is what keeps the stacked reading
   order equal to the DOM order â€” the columns are grid tracks over one unchanged
   tree, so no control is duplicated for a breakpoint.

   1360px, not 1000px: a settings panel is now half of a tool row rather than the
   page's full width, so two tracks only become usable once the row itself is wide.
   Splitting a 390px half into two 180px columns is worse than one readable column,
   which is the failure this breakpoint exists to avoid. */
@media (min-width: 1360px) {
  .form_table.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .form_table.cols-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .form_table.cols-2 > .form_col:not(:last-child),
  .form_table.cols-3 > .form_col:not(:last-child) { border-right: 1px solid var(--line); padding-right: 14px; }
  .form_table > .settings-group-wide { border-right: 0 !important; padding-right: 0 !important; }
  .settings-filter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .settings-filter-grid > .form_col:not(:last-child) { border-right: 1px solid var(--line); padding-right: 14px; }
}

/* A third track, but only once the panel is wide enough to carry it. A settings
   panel is half a tool row, so at 1360px two tracks already sit near the readable
   floor and a third there would repeat the narrow-column failure the gate above
   exists to avoid. By ~1600px each half is ~760px, where three ~240px columns
   read well. Below this width a cols-3 table falls back to the two-track rule,
   then the one-track base â€” the same one-tree-many-tracks arrangement, so nothing
   is duplicated and the stacked reading order still equals the DOM order. */
@media (min-width: 1600px) {
  .form_table.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

/* textarea is listed here rather than left to the browser: without it the one
   multiline field on the page renders as a white serif box on a dark card. */
input[type=text], input[type=number], select, textarea {
  background: #16161b; border: 1px solid var(--line); border-radius: 8px; color: var(--text);
  padding: 6px 11px; font-size: 0.86rem; font-family: inherit; outline: none;
  transition: border-color .15s, box-shadow .15s; max-width: 100%;
}
input[type=text]:focus, input[type=number]:focus, select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(74,132,250,.15); }
select option { background: var(--card); }
select option:disabled { color: var(--dim); }
input[type=text].short { width: 52px; }
label { font-size: 0.85rem; color: var(--muted); cursor: pointer; user-select: none; }

/* Catalog-driven control rows */
.classic-field { margin-bottom: 1px; }
.classic-field.stacked { display: flex; flex-direction: column; gap: 3px; margin-bottom: 6px; }

/* Compact settings presentation.
   Existing Classic markup puts the control before the label in a few rows;
   order changes presentation only, while htmlFor/id retain the relationship. */
.classic-field .form_row.left > label {
  order: -1;
  flex: 1 1 auto;
  min-width: 0;
  text-align: left;
  color: var(--muted);
}
.classic-field .form_row.left > select,
.classic-field .form_row.left > input[type=text],
.classic-field .form_row.left > input[type=number] {
  flex: 0 1 62%;
  min-width: 0;
}
.font-picker-field > label { display: block; margin-bottom: 2px; font-size: .77rem; color: var(--muted); }
.font-picker-control { position: relative; min-width: 0; }
.font-picker-control > input[type=text] { width: 100%; min-width: 0; height: 38px; font-size: .82rem; }
.font-picker-custom-field { margin-top: 6px; }
.font-picker-custom-field > label { display: block; margin-bottom: 2px; font-size: .77rem; color: var(--muted); }
.font-picker-custom-field > input[type=text] { width: 100%; min-width: 0; height: 38px; font-size: .82rem; }
.font-picker-options {
  position: absolute; z-index: 55; top: calc(100% + 5px); left: 0;
  width: 430px; min-width: 100%; max-width: calc(100vw - 48px);
  max-height: 340px; overflow-y: auto; padding: 5px 9px 5px 5px;
  overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-color: #555562 transparent;
  border: 1px solid #383844; border-radius: 9px; background: #18181e;
  box-shadow: 0 12px 32px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.45);
}
.font-picker-options::-webkit-scrollbar { width: 8px; }
.font-picker-options::-webkit-scrollbar-track { background: transparent; }
.font-picker-options::-webkit-scrollbar-thumb { background: #555562; border-radius: 999px; }
.font-picker-options::-webkit-scrollbar-thumb:hover { background: #71717f; }
.font-picker-option {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; min-width: 0; min-height: 36px; padding: 7px 9px; border: 0; border-radius: 6px;
  color: var(--text); background: transparent; font-size: .8rem; text-align: left; cursor: pointer;
  content-visibility: auto; contain-intrinsic-size: auto 36px;
}
.font-picker-option > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.font-picker-option:hover,
.font-picker-option[data-active=true] { background: rgba(74,132,250,.2); }
.font-picker-option[data-current=true] { box-shadow: inset 2px 0 0 var(--accent); }
.font-picker-current {
  flex: 0 0 auto; color: var(--accent); font-family: 'Montserrat', 'Noto Sans JP', system-ui, sans-serif;
  font-size: .58rem; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
}
.font-picker-empty { margin: 0; padding: 9px 8px; color: var(--dim); font-size: .72rem; }
.typography-panel {
  grid-column: 1 / -1;
  display: flex; flex-direction: column; gap: 7px; padding: 8px;
  border: 1px solid var(--line); border-radius: 9px; background: rgba(12,12,16,.32);
}
.counter-typography-panel { width: 100%; }
.typography-heading h4 {
  margin: 0; color: var(--text); font-size: .76rem; font-weight: 800;
  letter-spacing: .08em; text-transform: uppercase;
}
.typography-primary-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px; }
.typography-secondary-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px; }
.typography-style-field > .classic-field { margin: 0; }
.typography-style-field .form_row.left {
  display: flex; flex-direction: column; align-items: stretch; gap: 3px; margin: 0;
}
.typography-style-field .form_row.left > label { order: -1; font-size: .77rem; }
.typography-style-field .form_row.left > select { width: 100%; flex: none; }
.typography-italic-field { display: flex; align-items: flex-end; min-width: 0; }
.typography-italic-field > .classic-field { width: 100%; margin: 0; }
.typography-size-field { padding-top: 6px; border-top: 1px solid rgba(255,255,255,.055); }
.typography-size-field > .classic-field { margin: 0; }
.typography-effects {
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px 12px;
  padding-top: 9px; border-top: 1px solid var(--line);
}
.typography-subheading {
  grid-column: 1 / -1;
  margin: 0 0 6px; color: var(--dim); font-size: .62rem; font-weight: 800;
  letter-spacing: .08em; text-transform: uppercase;
}
@media (min-width: 720px) {
  .typography-primary-grid { grid-template-columns: minmax(0, 1.35fr) minmax(100px, .65fr); }
  .typography-secondary-grid { grid-template-columns: minmax(0, 1.35fr) minmax(100px, .65fr); }
  .typography-effects { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
.classic-field.stacked label { font-size: 0.77rem; color: var(--dim); }
.classic-field.stacked input[type=text], .classic-field.stacked textarea { width: 100%; font-size: 0.8rem; }
.classic-help { font-size: 0.71rem; line-height: 1.35; color: var(--dim); margin: 1px 0 5px; }
.classic-help.warn { color: var(--warn); }

/* Segmented pills â€” a radio group wearing the chip design language. The real
   radio is the focus target and stays visually hidden; the label is the pill, so
   arrow keys, the single tab stop, and group semantics are the platform's. */
.classic-seg { border: none; margin: 0 0 5px; padding: 0; min-width: 0; }
.classic-seg legend { font-size: 0.77rem; color: var(--muted); padding: 0; margin-bottom: 3px; }
.classic-seg-row { display: flex; flex-wrap: wrap; gap: 3px; background: #16161b; border: 1px solid var(--line); border-radius: 8px; padding: 3px; }
.classic-seg-item { display: inline-flex; flex: 1 1 auto; }
.classic-seg-item input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.classic-seg-label {
  flex: 1; text-align: center; white-space: nowrap;
  font-size: 0.71rem; font-weight: 700; padding: 4px 9px; border-radius: 6px;
  cursor: pointer; color: var(--dim); transition: background .12s, color .12s;
}
.classic-seg-label:hover { color: var(--muted); background: rgba(255,255,255,.04); }
.classic-seg-label.on { background: var(--accent); color: #fff; }
.classic-seg-label.on:hover { background: var(--accent-2); color: #fff; }
.classic-seg-item input:disabled + .classic-seg-label { opacity: .4; cursor: not-allowed; }
/* The ring is drawn on the label because the radio itself is invisible. */
.classic-seg-item input:focus-visible + .classic-seg-label { outline: 2px solid var(--accent-2); outline-offset: 1px; }

/* Slider row â€” track, live readout, and the button back to blank */
.classic-range { display: flex; align-items: center; gap: 8px; }
.classic-range input[type=range] { flex: 1; min-width: 0; accent-color: var(--accent); height: 20px; cursor: pointer; }
.classic-range-out { font-family: 'Roboto Mono', monospace; font-size: 0.72rem; color: var(--accent); min-width: 3.4em; text-align: right; }


.toggle-wrap { display: flex; align-items: center; gap: 10px; justify-content: flex-end; margin-bottom: 2px; }
.toggle-wrap > label:first-child { font-size: 0.82rem; color: var(--muted); cursor: pointer; user-select: none; order: -1; flex: 1; text-align: right; }

/* Inside catalog settings, use an app-style label-left / switch-right row.
   Other preview controls that reuse .toggle-wrap keep their existing layout. */
.classic-field .toggle-wrap {
  justify-content: space-between;
  min-height: 26px;
  margin-bottom: 1px;
}
.classic-field .toggle-wrap > label:first-child {
  text-align: left;
}
.toggle { position: relative; width: 40px; height: 22px; flex-shrink: 0; display: inline-block; }
.toggle input { position: absolute; opacity: 0; width: 40px; height: 22px; margin: 0; cursor: pointer; z-index: 1; }
.toggle-slider { position: absolute; inset: 0; background: #34343e; border-radius: 999px; cursor: pointer; transition: background .2s ease-in-out; }
.toggle-slider::before { content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,.4); transition: transform .2s ease-in-out; }
.toggle input:checked + .toggle-slider { background: var(--accent); }
.toggle input:checked + .toggle-slider::before { transform: translateX(18px); }
/* The real checkbox is transparent, so its focus ring has to be drawn on the
   slider â€” without this the switches are keyboard-reachable but invisible. */
.toggle input:focus-visible + .toggle-slider { outline: 2px solid var(--accent-2); outline-offset: 2px; }

/* Colour pair: a Transparent button that clears the value, beside a swatch */
.classic-color { display: inline-flex; align-items: center; gap: 6px; }
.classic-clear { font-size: 0.72rem; padding: 3px 9px; border-radius: 5px; cursor: pointer; font-family: inherit; border: 1px solid var(--line); background: #2e2e2e; color: var(--muted); }
.classic-clear.on { border-color: var(--accent); color: var(--accent); }
.classic-color input[type=color] { width: 30px; height: 24px; padding: 0; border: 1px solid var(--line); border-radius: 5px; background: none; cursor: pointer; }

/* Chip group â€” native checkboxes, chip-shaped labels */
.classic-chips { border: none; margin: 0; padding: 0; min-width: 0; }
.classic-chips legend { font-size: 0.85rem; color: var(--muted); padding: 0; margin-bottom: 6px; }
.classic-chip-row { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.classic-chip { display: inline-flex; }
.classic-chip input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.classic-chip-label {
  font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
  padding: 4px 11px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line); background: transparent; color: var(--dim);
}
.classic-chip-label.on { border-color: var(--accent); background: rgba(74,132,250,.14); color: var(--accent-2); }
.classic-chip-label[data-platform=kick].on { border-color: #53fc18; background: rgba(83,252,24,.14); color: #53fc18; }
.classic-chip-label[data-platform=twitch].on { border-color: #a970ff; background: rgba(145,70,255,.16); color: #a970ff; }
.classic-chip-label[data-platform=youtube].on { border-color: #ff5b5b; background: rgba(255,68,68,.14); color: #ff5b5b; }
.classic-chip-label[data-platform=tiktok].on { border-color: #25F4EE; background: rgba(37,244,238,.12); color: #25F4EE; }
.classic-chip input:disabled + .classic-chip-label { opacity: .45; cursor: not-allowed; }
.classic-chip input:focus-visible + .classic-chip-label { outline: 2px solid var(--accent-2); outline-offset: 2px; }

/* Twitch connection, beside the pin-platform control in Chat settings. The
   optional account is only for native Twitch pins, so it sits with the pin
   controls it serves rather than under the Twitch channel input. */
.mc-pin-connect { margin-top: 8px; }
.mc-pin-connect .classic-conn { justify-content: flex-start; }
.mc-pin-connect .classic-conn-warn,
.mc-pin-connect .classic-conn-err { text-align: left; }
.mc-pin-connect .classic-help { margin-top: 6px; }
.classic-conn { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; margin-top: 2px; }
.classic-connect {
  font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
  padding: 6px 12px; border-radius: 8px; white-space: nowrap;
  border: 1px solid rgba(145,70,255,.45); background: rgba(145,70,255,.07); color: #a970ff;
}
.classic-connect:hover { background: rgba(145,70,255,.15); color: #bb8dff; opacity: 1; }
.classic-conn-who { font-size: 0.72rem; color: #77aaee; font-weight: 600; }
.classic-conn-warn { font-size: 0.7rem; color: var(--warn); flex-basis: 100%; text-align: center; }
.classic-conn-err { font-size: 0.7rem; color: var(--err); flex-basis: 100%; text-align: center; }
.classic-conn-btn {
  font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
  padding: 4px 9px; border-radius: 6px; cursor: pointer; font-family: inherit;
  border: 1px solid rgba(255,255,255,.18); background: transparent; color: #9aa;
}
.classic-conn-btn:hover { border-color: var(--accent); color: var(--accent); }
.classic-conn-btn:disabled { color: var(--dim); cursor: default; }

/* Preview surfaces */
/* The chat output header: the section title and the "Preview data" marker on one
   row. The title drops its own bottom margin here so the row sets the spacing,
   and the badge is pushed to the trailing edge so it reads as an aside to the
   title rather than a second heading. */
.preview-head { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; }
.preview-head .section-title { margin: 0; }
.preview-head .preview-badge { margin-left: auto; }
.preview-label { font-size: 0.73rem; color: var(--dim); margin-bottom: 5px; display: flex; align-items: center; gap: 8px; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
.preview-label button { background: none; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); font-size: 0.72rem; padding: 3px 9px; cursor: pointer; transition: all .15s; text-transform: none; letter-spacing: 0; font-weight: 600; font-family: inherit; }
.preview-label button:hover { border-color: var(--accent); color: var(--accent); }
.preview-surface { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; box-shadow: inset 0 2px 12px rgba(0,0,0,.3); min-height: 90px; }
.preview-surface.checkered { background: repeating-conic-gradient(#1a1a20 0% 25%, #131318 0% 50%) 0 0 / 16px 16px; }
.preview-surface.dark { background: #191919; }
.preview-surface.light { background: #f4f4f5; }
.preview-empty { display: flex; align-items: center; justify-content: center; padding: 20px 16px; color: var(--dim); font-size: 0.77rem; text-align: center; line-height: 1.45; }
/* "Preview data" marker, shown while a preview is showing fixtures rather than a
   real overlay. Deliberately quiet â€” it sits in the label row at the same size as
   the row's own text, states a fact, and is not styled as a warning. */
.preview-badge { border: 1px solid var(--line); border-radius: 6px; padding: 2px 7px; font-size: 0.66rem; color: var(--muted); letter-spacing: .06em; font-weight: 700; }
/* Custom preview messages, inside the chat output card.
   Compact on purpose: this sits under a 600px preview in a card that also holds
   the generated URL, so the fields share one row and the actions share another.
   Any taller and the chat settings card leaves the first screen. */
.preview-compose { margin-top: 8px; border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px 7px; background: rgba(255,255,255,.015); }
.preview-compose-note { font-size: 0.71rem; line-height: 1.35; color: var(--dim); margin: 0 0 7px; }
.preview-compose-row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
/* The platform pills take the slack, the name field keeps a usable width. */
.preview-compose-seg { flex: 1 1 260px; margin-bottom: 8px; }
.preview-compose-name { flex: 1 1 160px; }
.preview-compose-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
/* Disabled here means "nothing to do yet" rather than "not allowed": the button
   is still readable, it just stops looking clickable. */
.preview-compose-actions button:disabled { opacity: .45; cursor: not-allowed; border-color: var(--line); color: var(--dim); }
.preview-compose-status { font-size: 0.7rem; color: var(--dim); }

/* Live preview feed controls, inside the chat output card.
   Same card furniture as the composer beneath it â€” one border, one radius, one
   tint â€” because they are two controls on one preview rather than two panels. */
.preview-feed { margin-top: 8px; border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px 7px; background: rgba(255,255,255,.015); }
.preview-feed-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
/* The switch keeps its natural width; the buttons sit beside it rather than
   stretching, so a wrapped row does not leave a full-width Pause. */
.preview-feed-row .toggle-wrap { flex: 0 0 auto; gap: 8px; }
.preview-feed-seg { margin: 7px 0 0; }
/* Speed and scale, paired. Each takes an equal share of the row and wraps to its
   own line once the card is too narrow for two â€” flex-basis of 220px is the point
   below which a four-pill band would start to crowd. min-width:0 lets a segment
   shrink inside the flex track rather than forcing the row wider than the card. */
.preview-feed-segs { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-start; }
.preview-feed-segs > .preview-feed-seg { flex: 1 1 220px; min-width: 0; }
.preview-feed-seg legend, .preview-feed-sources legend { font-size: 0.71rem; font-weight: 700; color: var(--muted); letter-spacing: .04em; padding: 0; margin-bottom: 5px; }
/* The fixture chips wrap; they are the only part of this card that can grow, and
   they grow downward rather than pushing the row's buttons around. */
.preview-feed-sources { border: 0; padding: 0; margin: 8px 0 0; min-width: 0; }
/* Left-aligned, unlike .classic-chip-row: these are a wrapping set rather than
   a right-hand control for a settings row, and a ragged right edge on nine
   chips reads as broken. */
.preview-feed-chips { display: flex; gap: 5px; flex-wrap: wrap; justify-content: flex-start; }
.preview-feed-chip .classic-chip-label { font-size: 0.66rem; padding: 3px 8px; }
.preview-feed-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 7px; }
.preview-feed-status { font-size: 0.7rem; color: var(--dim); margin: 6px 0 0; }
.preview-feed-row button:disabled { opacity: .45; cursor: not-allowed; border-color: var(--line); color: var(--dim); }
/* Preview scale. Borrows .preview-feed-seg for its legend and row; Reset goes
   flat once there is nothing left to reset. */
.preview-scale .preview-feed-actions { margin-top: 5px; }
.preview-feed-actions button:disabled { opacity: .45; cursor: not-allowed; border-color: var(--line); color: var(--dim); }

/* Preview background. Borrows .classic-seg for its legend and radio row; only the
   custom-colour field is particular. The backdrop it sets is preview-only. */
.preview-bg { margin: 8px 0 0; }
.preview-bg-custom { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.preview-bg-custom label { font-size: 0.72rem; color: var(--muted); font-weight: 600; }
.preview-bg-custom input[type="color"] { width: 40px; height: 26px; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: none; cursor: pointer; }

/* Preview Identity. A compact request/status surface below the production
   preview. Provider art never appears here; loaded resources are shown only in
   chat rows above. */
.preview-identity { margin-top: 8px; border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px; background: rgba(145,70,255,.035); }
.preview-identity-title { margin: 0 0 7px; color: #b98cff; font-size: .75rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.preview-identity-form { display: flex; flex-direction: column; gap: 4px; }
.preview-identity-form > label { color: var(--dim); font-size: .7rem; }
.preview-identity-input-row { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.preview-identity-input-row input { flex: 1 1 180px; min-width: 0; }
.preview-identity-input-row button:disabled, .preview-identity-retry:disabled { opacity: .45; cursor: not-allowed; }
.preview-identity-status { color: var(--dim); font-size: .7rem; line-height: 1.4; margin-top: 6px; }
.preview-identity-status strong { color: var(--text); font-size: .76rem; }
.preview-identity-providers { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
.preview-identity-provider { border: 1px solid var(--line); border-radius: 999px; color: var(--dim); font-size: .63rem; font-weight: 700; padding: 3px 7px; }
.preview-identity-provider[data-status="loaded"] { border-color: rgba(47,191,113,.55); color: var(--ok); background: rgba(47,191,113,.08); }
.preview-identity-provider[data-status="failed"] { border-color: rgba(238,119,119,.55); color: var(--err); background: rgba(238,119,119,.07); }
.preview-identity-provider[data-status="unavailable"] { color: var(--muted); }
.preview-identity-retry { margin-top: 7px; }
.preview-identity-details { margin-top: 7px; color: var(--dim); font-size: .68rem; line-height: 1.4; }
.preview-identity-details summary { cursor: pointer; color: var(--muted); font-weight: 700; }
.preview-identity-details ul { margin: 5px 0 0; padding-left: 18px; }

/* Preview badge refresh. What replaced the browsable gallery: one button that
   asks the loader for the full 7TV set, and a one-line status beside it. It
   borrows .classic-conn-btn for the button so it reads as the same kind of
   surface the gallery's action did. The loaded badges are drawn in the feed
   beside usernames, not here â€” this control owns no art of its own. */
.preview-badge-refresh { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0 0; min-width: 0; }
.preview-badge-refresh button:disabled { opacity: .45; cursor: not-allowed; border-color: var(--line); color: var(--dim); }
.preview-badge-status { font-size: 0.7rem; color: var(--dim); margin: 0; }
.preview-badge-status[data-status="error"] { color: var(--warn, #e0685a); }

/* Counter simulation controls, inside the Counter output card. Reuses
   .preview-feed for the card itself so the two preview control surfaces read as
   the same kind of thing; only the manual section below is particular to it. */
.preview-counter-feed .preview-feed-row { row-gap: 6px; }
/* The four numeric fields used to be always visible and were the tallest thing
   in this card. Collapsed, the card is a row of controls; open, it is what it
   was before. The rule is a separator rather than a nested box â€” a second
   border inside a bordered card reads as a card inside a card. */
.preview-manual { margin-top: 8px; border-top: 1px solid var(--line); padding-top: 7px; }
.preview-manual > summary { font-size: 0.71rem; font-weight: 700; color: var(--muted); letter-spacing: .04em; cursor: pointer; list-style-position: outside; padding: 1px 0; }
.preview-manual > summary:hover { color: var(--fg); }
/* Keyboard focus lands on the summary, and it is the only way to discover the
   section, so the ring must not be the browser's default invisible-on-dark. */
.preview-manual > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.preview-manual[open] > summary { color: var(--fg); margin-bottom: 7px; }
.preview-counts-fields { display: flex; gap: 10px; flex-wrap: wrap; border: 0; padding: 0; margin: 0 0 7px; }
.preview-counts-fields legend { font-size: 0.71rem; font-weight: 700; color: var(--muted); letter-spacing: .04em; padding: 0; margin-bottom: 6px; }
.preview-counts-field { display: flex; flex-direction: column; gap: 3px; flex: 1 1 92px; }
.preview-counts-field label { font-size: 0.68rem; color: var(--dim); }
/* Tabular digits so the four fields do not shift width as numbers are typed. */
.preview-counts-field input[type=text] { width: 100%; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
.preview-counts-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.preview-counts-actions .classic-help { margin: 0; flex: 1 1 220px; }

/* URL result.
   The field takes the row and the two actions sit beside it at their natural
   height. Previously all three were align-items:stretch flex items, so Copy
   and Open grew to match a URL that wrapped to three lines â€” a ~70px-tall Copy
   button next to a two-line field. Now the actions are their own row-aligned
   group and the field is free to wrap without dragging them with it. */
.url-box { display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; margin-top: 9px; }
.url-code { flex: 1 1 220px; min-width: 0; background: #101014; border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; font-family: 'Roboto Mono', monospace; font-size: 0.69rem; color: var(--accent); word-break: break-all; line-height: 1.55; max-height: 74px; overflow-y: auto; }
.url-actions { display: flex; gap: 6px; align-items: center; flex: 0 0 auto; }
.url-copy { background: var(--accent); color: #fff; border: none; border-radius: 8px; font-weight: 800; font-size: 0.78rem; padding: 7px 15px; cursor: pointer; transition: background .15s; font-family: inherit; white-space: nowrap; }
.url-copy:hover { background: var(--accent-2); }
.url-copy.ok { background: var(--ok); }
.url-open { display: inline-flex; align-items: center; justify-content: center; font-size: 0.78rem; font-weight: 800; padding: 7px 14px; border-radius: 8px; background: transparent; border: 1px solid rgba(74,132,250,.5); color: var(--accent); white-space: nowrap; }
.url-open:hover { background: rgba(74,132,250,.1); }
.url-warn { flex-basis: 100%; font-size: 0.72rem; color: var(--warn); line-height: 1.4; margin: 0; }
/* Empty is the common case â€” no fragment â€” so it must not reserve a line. */
.url-warn:empty { display: none; }
/* Below the grid breakpoint the actions wrap under the field and share its
   width, which is the touch-friendly arrangement. */
@media (max-width: 999px) {
  .url-actions { flex: 1 1 100%; }
  .url-copy, .url-open { flex: 1; padding: 10px 14px; }
}

/* Commands table */
.cmd-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.cmd-table th { text-align: left; color: var(--dim); font-weight: 700; text-transform: uppercase; font-size: 0.68rem; letter-spacing: .08em; padding: 3px 10px 6px; border-bottom: 1px solid var(--line); }
.cmd-table td { padding: 5px 10px; color: var(--muted); border-bottom: 1px solid rgba(44,44,53,.5); vertical-align: top; line-height: 1.4; }
.cmd-table td:first-child { color: var(--accent); font-family: 'Roboto Mono', monospace; white-space: nowrap; font-size: 0.72rem; }
.cmd-table tr:last-child td { border-bottom: none; }
.cmd-table-wrap { overflow-x: auto; }

/* Setup steps. Two side-by-side lists on a wide screen: they are independent
   procedures for two independent browser sources, so stacking them was pure
   height. */
.steps { list-style: none; padding: 0; margin: 0 0 10px; counter-reset: s; }
.steps li { counter-increment: s; display: flex; gap: 10px; align-items: flex-start; margin-bottom: 6px; font-size: 0.82rem; color: var(--muted); line-height: 1.45; }
.steps li::before { content: counter(s); background: rgba(74,132,250,.12); border: 1px solid rgba(74,132,250,.4); border-radius: 50%; min-width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700; color: var(--accent); flex-shrink: 0; margin-top: 1px; }
.steps li strong { color: var(--text); }
.setup-sub { font-size: 0.79rem; font-weight: 800; color: var(--text); margin: 0 0 6px; }
.setup-cols { display: grid; grid-template-columns: 1fr; gap: 0 22px; }
@media (min-width: 1000px) { .setup-cols { grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); } }

/* Footer */
footer { border-top: 1px solid var(--line); padding: 16px 0; text-align: center; font-size: 0.77rem; color: var(--dim); margin-top: 14px; }
footer p { margin: 4px 0; }
footer a { color: var(--accent); }

/* Tablet and narrow desktop: one column, so two unusably narrow panels never
   happen. The control table stacks at the same breakpoint the original used. */
@media (max-width: 999px) {
  .form_col { padding-right: 0; }
}
@media (max-width: 720px) {
  .form_table { padding: 12px 12px 8px; }
  .header-logo { height: 200px; margin: -24px 0 -54px; }
  .header-strip { gap: 12px; flex-wrap: wrap; }
  .header-title { font-size: 1.6rem; }
  .page { padding: 0 14px 40px; }
  .card { padding: 14px 13px; border-radius: 12px; }
  .card.hero { padding: 15px 13px 12px; }
  .platform-input { min-width: 100%; }
  .tool-grid, .panel-chat-output, .panel-counter-output { min-width: 0; max-width: 100%; }
  .preview-mode-tabs, .preview-primary-actions,
  .preview-feed-row, .preview-feed-segs, .preview-compose-row, .url-box { flex-wrap: wrap; }
  .preview-mode-tab { flex: 1 1 130px; }
  .preview-primary-actions > button { flex: 1 1 130px; }
  /* Touch targets: the chips, pills, and small buttons are the only controls that
     fall under a comfortable tap size at these sizes. Density is a desktop goal,
     and a 24px-tall pill on a phone is not a usable one. */
  .classic-chip-label { padding: 8px 14px; font-size: 0.7rem; }
  .classic-seg-label { padding: 9px 10px; }
  .classic-conn-btn, .classic-clear { padding: 8px 12px; }
  .toggle-wrap { margin-bottom: 6px; }
  .url-code { max-height: none; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

.badge-layout-fieldset { border: 0; border-top: 1px solid var(--line); padding: 10px 0 0; margin: 10px 0 0; min-width: 0; }
.badge-layout-fieldset legend { font-size: .76rem; font-weight: 800; color: var(--text); letter-spacing: .02em; padding: 0; }
.badge-layout-row { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 8px; }
.badge-layout-tile { width: 82px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255,255,255,.025); overflow: hidden; transition: opacity .14s ease, border-color .14s ease, transform .14s ease; }
.badge-layout-tile.dragging { opacity: .5; transform: scale(.98); }
.badge-layout-tile.off { opacity: .42; }
.badge-layout-toggle { width: 100%; min-height: 64px; border: 0; background: transparent; color: var(--text); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font: inherit; font-size: .68rem; cursor: pointer; padding: 6px 3px 3px; }
.badge-layout-mark { min-width: 28px; height: 28px; padding: 0 5px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; background: linear-gradient(145deg, #9147ff, #3f8cff); color: white; font-size: .67rem; font-weight: 900; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
.badge-layout-state { font-size: .7rem; color: #4b8cff; }
.badge-layout-move { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--line); }
.badge-layout-move button { border: 0; background: rgba(255,255,255,.02); color: var(--muted); cursor: pointer; font-size: 1rem; line-height: 22px; }
.badge-layout-move button + button { border-left: 1px solid var(--line); }
.badge-layout-move button:disabled { opacity: .2; cursor: default; }
.badge-layout-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.pogly-widget-button { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 36px; margin-top: 9px; border: 1px solid #3c4658; border-radius: 8px; background: rgba(255,255,255,.025); color: var(--text); text-decoration: none; font-size: .76rem; font-weight: 800; transition: border-color .15s ease, background .15s ease; pointer-events: auto; }
.pogly-widget-button:hover { border-color: #4b8cff; background: rgba(75,140,255,.09); }

`;
