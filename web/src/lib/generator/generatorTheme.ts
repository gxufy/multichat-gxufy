/*
 * The generator's shapes and type: Funnel Sans (Funnel Display for
 * headings), large rounded panels, rows with the label on the left and the
 * control on the right, and pill-shaped fields, choices and buttons. The
 * colours stay the classic generator's own (classicStyles.ts: the charcoal
 * cards, the blue accent), as do the layout, markup and behaviour; this sheet
 * changes shape, spacing and type only. Everything is scoped to the header,
 * the section bar and #generator-main, so the popups and the overlay previews
 * keep their own styles.
 */

const MAIN = '#generator-main';

/** Its faces, from Google Fonts with the generator's other UI fonts. */
export const GENERATOR_THEME_FONT_SPECS: readonly string[] = [
	'Funnel+Sans:wght@300..800',
	'Funnel+Display:wght@300..800'
];

const DISPLAY = `'Funnel Display', 'Funnel Sans', 'Montserrat', sans-serif`;

export const GENERATOR_THEME_CSS = `
${MAIN}, .page .section-nav, .page > header.header-strip, .page.page-footer {
  font-family: 'Funnel Sans', 'Montserrat', 'Noto Sans JP', system-ui, sans-serif;
}

/* Header and section bar */
.page > header.header-strip .header-title { font-family: ${DISPLAY}; font-weight: 700; letter-spacing: -.035em; }
.page .home-link { font-weight: 600; }
.page .section-nav a { font-weight: 600; }

/* Panels */
${MAIN} .card { border-radius: 28px; padding: 22px 24px; margin-bottom: 18px; }
${MAIN} .card.hero { padding: 22px 24px 18px; }
${MAIN} .section-title, ${MAIN} .preview-content-title {
  font-family: ${DISPLAY}; font-size: 1.2rem; font-weight: 600;
  letter-spacing: -.015em; text-transform: none; gap: 10px; margin-bottom: 4px;
}
${MAIN} .section-title::before, ${MAIN} .preview-content-title::before { height: 18px; }
${MAIN} .settings-panel-head { margin-bottom: 14px; }
${MAIN} .section-sub { font-size: .86rem; }
${MAIN} .classic-help { font-size: .76rem; }

/* Settings: each group a rounded block of rows, label left, control right */
${MAIN} .tool-grid .form_table { border-radius: 22px; padding: 6px 16px 10px; gap: 6px 18px; }
${MAIN} .col-heading { text-transform: none; letter-spacing: 0; }
${MAIN} .tool-grid .settings-group-toggle {
  min-height: 42px; padding: 8px 2px;
  font-family: ${DISPLAY}; font-size: .98rem; font-weight: 600; letter-spacing: -.005em;
}
${MAIN} .settings-group-chevron { font-size: 1.15rem; }
${MAIN} .tool-grid .settings-group-body > * { padding: 9px 0; }
${MAIN} .tool-grid .classic-field .form_row.left > label,
${MAIN} .tool-grid .classic-field .toggle-wrap > label:first-child,
${MAIN} .tool-grid .classic-field.stacked > label,
${MAIN} .tool-grid .classic-field .classic-seg > legend,
${MAIN} .tool-grid .classic-field .classic-chips > legend,
${MAIN} .tool-grid .font-picker-field > label, ${MAIN} .tool-grid .font-picker-custom-field > label,
${MAIN} .tool-grid .typography-style-field .form_row.left > label { font-weight: 500; font-size: .86rem; }
${MAIN} .typography-panel { border-radius: 18px; padding: 10px 12px; gap: 9px; }
${MAIN} .typography-heading h4 { text-transform: none; letter-spacing: 0; font-size: .9rem; font-weight: 600; }
${MAIN} .typography-subheading { text-transform: none; letter-spacing: 0; font-size: .82rem; font-weight: 600; }

/* Fields */
${MAIN} input[type=text], ${MAIN} input[type=number], ${MAIN} select, ${MAIN} textarea {
  border-radius: 999px; padding: 8px 15px; font-size: .86rem;
}
${MAIN} textarea { border-radius: 18px; }
${MAIN} .font-picker-options, ${MAIN} .channel-suggestions { border-radius: 18px; }
${MAIN} .font-picker-option, ${MAIN} .channel-suggestion { border-radius: 10px; }

/* Segmented choices */
${MAIN} .classic-seg-row, ${MAIN} .tool-grid .classic-field > .classic-seg > .classic-seg-row {
  border-radius: 18px; padding: 3px; gap: 2px;
}
${MAIN} .classic-seg-label, ${MAIN} .tool-grid .classic-field > .classic-seg .classic-seg-label {
  border-radius: 999px; font-weight: 600; font-size: .76rem; padding: 5px 12px;
}

/* Buttons and chips */
${MAIN} .classic-conn-btn, ${MAIN} .classic-clear, ${MAIN} .preview-label button, ${MAIN} .obs-copy {
  border-radius: 999px; text-transform: none; letter-spacing: 0; font-weight: 600; font-size: .76rem; padding: 6px 14px;
}
${MAIN} .classic-color input[type=color] { border-radius: 10px; }
${MAIN} .classic-chip-label { border-radius: 999px; text-transform: none; letter-spacing: 0; font-weight: 600; font-size: .74rem; }
${MAIN} .pogly-widget-button { border-radius: 999px; }
${MAIN} .badge-layout-tile { border-radius: 14px; }

/* Preview controls */
${MAIN} .preview-mode-tabs {
  display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px;
  background: #16161b; border: 1px solid var(--line);
}
${MAIN} .preview-mode-tab { border: 0; border-radius: 999px; font-weight: 600; font-size: .78rem; padding: 6px 14px; }
${MAIN} .preview-mode-tab.active { border: 0; }
${MAIN} .preview-mode-label, ${MAIN} .preview-label { text-transform: none; letter-spacing: 0; }
${MAIN} .preview-badge { border-radius: 999px; padding: 3px 10px; letter-spacing: 0; }
${MAIN} .preview-surface { border-radius: 20px; }
${MAIN} .preview-compose, ${MAIN} .preview-feed, ${MAIN} .preview-identity { border-radius: 18px; }
${MAIN} .preview-identity-title { text-transform: none; letter-spacing: 0; }

/* The generated URL */
${MAIN} .url-code { border-radius: 16px; padding: 9px 13px; }
${MAIN} .url-copy, ${MAIN} .url-open { border-radius: 999px; padding: 8px 18px; }

/* Commands and OBS setup */
${MAIN} .cmd-row { border-radius: 14px; }
${MAIN} .obs-card { border-radius: 22px; }
${MAIN} .obs-card-title { font-family: ${DISPLAY}; font-weight: 600; }
${MAIN} .obs-note { border-radius: 16px; }

@media (max-width: 720px) {
  ${MAIN} .card { border-radius: 22px; padding: 16px 15px; }
  ${MAIN} .tool-grid .form_table { border-radius: 18px; padding: 4px 12px 8px; }
  ${MAIN} .classic-seg-label, ${MAIN} .tool-grid .classic-field > .classic-seg .classic-seg-label { padding: 9px 12px; }
}
`;
