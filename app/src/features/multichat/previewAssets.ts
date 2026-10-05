/* Generator-only preview asset catalog: local, offline, repo-owned art.
 *
 * WHY THIS EXISTS. The built-in preview once declared its 7TV cosmetic badge and
 * its 7TV emotes as absolute `https://cdn.7tv.app/...` URLs built from retired
 * base32 ids. 7TV migrated to hex ObjectIds and those URLs now 404, so the base
 * preview rendered a broken-image icon beside the entitled name and the emote
 * word-swaps failed — before anyone typed a channel or refreshed anything. A
 * preview that depends on a third-party CDN being up is not a reliable preview.
 *
 * So every image a preview *fixture* owns lives here as a data URI or a
 * repository-served path, and nothing here reaches the network. This is the one
 * typed place that art is declared; `samples.tsx` and `previewSimulator.ts`
 * reference these names rather than writing URLs of their own.
 *
 * WHAT THIS IS NOT. This changes nothing about how a real OBS overlay resolves
 * live provider badges and emotes — `lib/render.tsx`, `lib/cosmetics.ts` and
 * `lib/twitchEmotes.ts` still fetch the genuine CDN art at runtime. This catalog
 * is generator-only, for the fixtures the preview invents.
 *
 * THE ARTWORK. Every glyph below is original, generic MultiChat-owned SVG: a gem,
 * plain laughing faces, raindrops, a note, a grin. None imitates a 7TV, BTTV,
 * FFZ or Twitch logo — the point is to demonstrate that the production renderer
 * draws normalized badge/emote/paint metadata, not to reproduce a provider mark.
 *
 * Browser-safe — no server-only imports, no secrets, no network.
 */

/**
 * Wrap raw inner SVG markup as a UTF-8 data URI.
 *
 * `encodeURIComponent` so '#' in a fill and the spaces in path data survive the
 * `src` attribute. Matches the inline-SVG form already used for the YouTube badge
 * art in lib/render.tsx, so the preview and the renderer speak the same dialect.
 *
 * WIDTH AND HEIGHT ARE NOT DECORATION HERE. A `viewBox` alone gives an SVG a ratio
 * but no intrinsic size, and the renderer's zero-width path puts the base emote in a
 * shrink-to-fit wrapper as `display: block` — a sizeless replaced element inside a
 * width-auto parent collapses, which drew a 6px smudge instead of a full emote in a
 * real browser while every jsdom assertion still passed.
 *
 * The stated size is deliberately larger than any cap the renderer applies, because
 * that is the situation the renderer is written for: provider emotes and badges
 * arrive as raster art bigger than the line, and `max-height` scales them down to it.
 * A fixture declared at the artwork's own 24 units would instead be drawn at 24px and
 * quietly ignore the cap, so the preview would disagree with OBS about size. The
 * `viewBox` keeps the coordinates the art is drawn in, so nothing below changes.
 */
const ART_PX = 128;

/**
 * `w`/`h` are the declared intrinsic size and `vb` the coordinate space. They are
 * separate because the two answer different questions: `vb` is where the art is
 * drawn, `w`/`h` is what the renderer measures. Emote fixtures deliberately vary
 * both — square and wide, above and below the height cap — because uniform
 * 128x128 art cannot show whether the renderer preserves an aspect ratio or
 * draws every provider at one height. Both are silently correct on square art.
 */
function svgDataUri(
  inner: string,
  opts: { w?: number; h?: number; vb?: string } = {},
): string {
  const w = opts.w ?? ART_PX;
  const h = opts.h ?? ART_PX;
  const vb = opts.vb ?? '0 0 24 24';
  return (
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
        `viewBox="${vb}">${inner}</svg>`,
    )
  );
}

/* ------------------------------------------------------------------ */
/* Badge art                                                          */
/* ------------------------------------------------------------------ */

/** The 7TV cosmetic badge fixture: a plain purple gem, not the 7TV logo. */
export const PREVIEW_SEVENTV_BADGE_IMAGE = svgDataUri(
  '<path fill="#8a5cf6" d="M6 3h12l4 6-10 12L2 9Z"/>' +
    '<path fill="#c4b1fb" d="M6 3h12l-6 6Zm-4 6 4-6 6 6-6 12Z"/>',
);

/* FFZ room-badge overrides, as local data URIs. Production receives these as a
   `url` on a mod or VIP badge resolved from the FFZ CDN at runtime; the preview
   supplies its own generic art through the same field, and `renderBadges` draws
   any badge carrying a `url` directly — so this exercises the real path. */
export const PREVIEW_FFZ_MOD_BADGE = svgDataUri(
  '<path fill="#5c16c5" d="M3 4h18v13a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z' +
    'm4.6 4.2v7.6h2V12l2.4 2.7 2.4-2.7v3.8h2V8.2h-2L12 11.4 9.6 8.2Z"/>',
);

export const PREVIEW_FFZ_VIP_BADGE = svgDataUri(
  '<path fill="#e005b9" d="M2 6h4l3 9 3-9h4l-6 13H8Zm14 0h4v13h-4Z"/>',
);

/* Fixture-owned platform badge art that renders as a literal `url`, kept as a
   repository-served path (never a remote host).

   TikTok is the one platform whose badges arrive this way: `renderBadges` has no
   TikTok lookup table, because the live connector delivers finished art per
   badge. So the TikTok fixtures supply a url and the renderer draws it directly,
   adding ck-badge-wide for that platform. Every other native badge here is
   resolved by `renderBadges` from a badge *type* and is not a fixture-owned
   image. */
export const PREVIEW_TIKTOK_MOD_BADGE = '/badges/moderator.svg';
export const PREVIEW_TIKTOK_SUB_BADGE = '/badges/subscriber.svg';

/* ------------------------------------------------------------------ */
/* Emote art                                                          */
/* ------------------------------------------------------------------ */

/* Original art. None reproduces a real emote — each fixture exists to exercise
   one renderer behaviour and to be recognisable as an emote at overlay size,
   which flat single-tone glyphs were not. Shading, an outline and a highlight
   are what make them read as art rather than as icons.

   The set is deliberately uneven, because that is what providers actually serve:
   one animated, one wide, one declared below the height cap, the rest square.
   The renderer has to land all of them on one baseline at one height without
   stretching any. Uniform square art cannot show whether it does. */

/** An open-mouthed laugh, animated — the plain 7TV emote fixture. SMIL runs in
 *  an SVG loaded through `<img>` in Chromium, so this also proves the renderer
 *  does not freeze animated provider art. */
export const PREVIEW_EMOTE_LAUGH = svgDataUri(
  '<defs><radialGradient id="f" cx="35%" cy="30%">' +
    '<stop offset="0" stop-color="#ffe89a"/><stop offset="1" stop-color="#f2a81c"/>' +
    '</radialGradient></defs>' +
    '<g><animateTransform attributeName="transform" type="scale" ' +
    'values="1;1.06;1" dur="0.9s" repeatCount="indefinite" additive="sum"/>' +
    '<circle cx="12" cy="12" r="10.4" fill="url(#f)" stroke="#8a5a06" stroke-width="0.7"/>' +
    '<ellipse cx="8.2" cy="7.8" rx="2.6" ry="1.4" fill="#fff" opacity="0.45"/>' +
    '<path fill="#2a1a05" d="M6.4 8.6c1.2-1.6 3-1.6 4.2 0-1.3-.8-2.9-.8-4.2 0Z"/>' +
    '<path fill="#2a1a05" d="M13.4 8.6c1.2-1.6 3-1.6 4.2 0-1.3-.8-2.9-.8-4.2 0Z"/>' +
    '<path fill="#3d1616" d="M6 12.6h12c-.6 4.8-11.4 4.8-12 0Z"/>' +
    '<path fill="#fff" d="M7.3 13.1h9.4c-.2 1-9.2 1-9.4 0Z"/>' +
    '<path fill="#e2607a" d="M9.2 17.6c1.7 1.1 3.9 1.1 5.6 0-1.3-1.4-4.3-1.4-5.6 0Z"/></g>',
);

/** A squinting side-eye grin — the second 7TV fixture, and deliberately the wide
 *  one at 3:2. Providers serve plenty of non-square emotes, and a stretched or
 *  squared-off render is obvious here in a way it never is on square art. */
export const PREVIEW_EMOTE_GRIN = svgDataUri(
  '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#ffe07a"/><stop offset="1" stop-color="#e8991a"/>' +
    '</linearGradient></defs>' +
    '<rect x="0.6" y="1.4" width="34.8" height="21.2" rx="9" fill="url(#g)" ' +
    'stroke="#8a5a06" stroke-width="0.7"/>' +
    '<ellipse cx="9" cy="6.4" rx="4.4" ry="1.8" fill="#fff" opacity="0.4"/>' +
    '<path fill="none" stroke="#2a1a05" stroke-width="1.5" stroke-linecap="round" ' +
    'd="M7 9.6 12 11.4 7 13.2M29 9.6 24 11.4l5 1.8"/>' +
    '<path fill="#3d1616" d="M11 15.4h14c-1 4.2-13 4.2-14 0Z"/>' +
    '<path fill="#fff" d="M12.4 15.9h11.2c-.3.9-10.9.9-11.2 0Z"/>',
  { w: 192, h: 128, vb: '0 0 36 24' },
);

/** A sheet of falling rain — the zero-width overlay fixture.
 *
 *  Wider than the base it sits over (4:3) and partly translucent, on purpose.
 *  Width proves the overlay contributes none of its own to the line: it visibly
 *  overhangs the base while the pair still occupies only the base's width.
 *  Translucency proves it is layered rather than simply drawn on top, since the
 *  base stays visible through it. Both were unfalsifiable against the previous
 *  opaque, narrower drops. */
export const PREVIEW_EMOTE_RAIN = svgDataUri(
  '<defs><linearGradient id="d" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#bfeaff" stop-opacity="0.95"/>' +
    '<stop offset="1" stop-color="#2f9fe0" stop-opacity="0.85"/>' +
    '</linearGradient></defs>' +
    '<g fill="url(#d)" stroke="#0d5f8f" stroke-width="0.35" stroke-opacity="0.7">' +
    '<path d="M4 2.6c2.1 3.2 3.1 4.9 3.1 6.3a3.1 3.1 0 0 1-6.2 0c0-1.4 1-3.1 3.1-6.3Z"/>' +
    '<path d="M16 1.6c2.3 3.5 3.4 5.4 3.4 6.9a3.4 3.4 0 0 1-6.8 0c0-1.5 1.1-3.4 3.4-6.9Z"/>' +
    '<path d="M28 3.2c1.9 2.9 2.8 4.5 2.8 5.8a2.8 2.8 0 0 1-5.6 0c0-1.3.9-2.9 2.8-5.8Z"/>' +
    '<path d="M9.5 13c1.7 2.6 2.5 4 2.5 5.1a2.5 2.5 0 0 1-5 0c0-1.1.8-2.5 2.5-5.1Z"/>' +
    '<path d="M22.5 14c1.5 2.3 2.2 3.5 2.2 4.5a2.2 2.2 0 0 1-4.4 0c0-1 .7-2.2 2.2-4.5Z"/>' +
    '</g>',
  { w: 192, h: 144, vb: '0 0 32 24' },
);

/** A cat's head nodding along — the BTTV emote fixture. Animated by rotation
 *  rather than scale, so the two animated fixtures are distinguishable when
 *  both are on screen. */
export const PREVIEW_EMOTE_CAT = svgDataUri(
  '<defs><linearGradient id="c" x1="0" y1="0" x2="0.3" y2="1">' +
    '<stop offset="0" stop-color="#ffc266"/><stop offset="1" stop-color="#e07f1c"/>' +
    '</linearGradient></defs>' +
    '<g><animateTransform attributeName="transform" type="rotate" ' +
    'values="-7 12 20;7 12 20;-7 12 20" dur="1.1s" repeatCount="indefinite"/>' +
    '<path fill="url(#c)" stroke="#8a4a06" stroke-width="0.7" ' +
    'd="M3.4 4.6 8 9.4h8l4.6-4.8v12.6a4 4 0 0 1-4 4H7.4a4 4 0 0 1-4-4Z"/>' +
    '<path fill="#ffd9a8" d="M5.4 6.6 7.8 9h2.4Zm13.2 0L16.2 9h-2.4Z"/>' +
    '<ellipse cx="9.4" cy="11.6" rx="1.5" ry="1.8" fill="#1b1b1b"/>' +
    '<ellipse cx="14.6" cy="11.6" rx="1.5" ry="1.8" fill="#1b1b1b"/>' +
    '<circle cx="9.9" cy="11" r="0.5" fill="#fff"/>' +
    '<circle cx="15.1" cy="11" r="0.5" fill="#fff"/>' +
    '<path fill="#e2607a" d="M12 14.4l1.2 1.1h-2.4Z"/>' +
    '<path fill="none" stroke="#1b1b1b" stroke-width="1.1" stroke-linecap="round" ' +
    'd="M10.4 16.4c1 .9 2.2.9 3.2 0"/>' +
    '<path fill="none" stroke="#8a4a06" stroke-width="0.6" stroke-linecap="round" ' +
    'd="M4 12.6 7 13m-3 2.2 3-.6m13 -1.6-3 .4m3 2.4-3-.6"/></g>',
);

/** A smug toothy grin — the FFZ emote fixture, declared at 32px on purpose.
 *
 *  That is below the renderer's height cap, which is the case the cap alone
 *  never covers: providers serve 1x variants, and with `height:auto` this drew
 *  at 32px next to neighbours at 42px. Being vector art it stays crisp when the
 *  renderer takes it up to the configured height, so this fixture demonstrates
 *  the height lock without looking like a scaling artefact. */
export const PREVIEW_EMOTE_SMILE = svgDataUri(
  '<defs><radialGradient id="s" cx="35%" cy="28%">' +
    '<stop offset="0" stop-color="#c8f5c0"/><stop offset="1" stop-color="#4fae57"/>' +
    '</radialGradient></defs>' +
    '<circle cx="12" cy="12" r="10.4" fill="url(#s)" stroke="#255c28" stroke-width="0.7"/>' +
    '<ellipse cx="8.4" cy="7.6" rx="2.6" ry="1.3" fill="#fff" opacity="0.45"/>' +
    '<path fill="none" stroke="#14320f" stroke-width="1.3" stroke-linecap="round" ' +
    'd="M6.4 9.8c1.2-1.4 3-1.4 4.2 0m3 0c1.2-1.4 3-1.4 4.2 0"/>' +
    '<path fill="#2b1414" d="M6.2 13.2c1.8 4 9.8 4 11.6 0Z"/>' +
    '<path fill="#fff" d="M7.6 13.7h8.8c-.4 1.1-8.4 1.1-8.8 0Z"/>' +
    '<path fill="#e2607a" d="M9.6 17.4c1.6 1 3.2 1 4.8 0-1.2-1.2-3.6-1.2-4.8 0Z"/>',
  { w: 32, h: 32 },
);

/** A dry-looking face — the native Twitch emote fixture (Kappa slot). Static and
 *  square, so the set has a plain baseline to compare the others against. */
export const PREVIEW_EMOTE_NATIVE = svgDataUri(
  '<defs><linearGradient id="n" x1="0" y1="0" x2="0.4" y2="1">' +
    '<stop offset="0" stop-color="#efeaf8"/><stop offset="1" stop-color="#b9b0d0"/>' +
    '</linearGradient></defs>' +
    '<rect x="1.6" y="1.6" width="20.8" height="20.8" rx="5" fill="url(#n)" ' +
    'stroke="#4a4266" stroke-width="0.7"/>' +
    '<ellipse cx="8.4" cy="6.6" rx="3.4" ry="1.5" fill="#fff" opacity="0.5"/>' +
    '<ellipse cx="9" cy="10.2" rx="1.5" ry="1.7" fill="#2e2842"/>' +
    '<ellipse cx="15" cy="10.2" rx="1.5" ry="1.7" fill="#2e2842"/>' +
    '<circle cx="9.5" cy="9.6" r="0.5" fill="#fff"/>' +
    '<circle cx="15.5" cy="9.6" r="0.5" fill="#fff"/>' +
    '<path fill="none" stroke="#2e2842" stroke-width="1.3" stroke-linecap="round" ' +
    'd="M8.2 15.4c2 1.5 5.6 1.5 7.6 0"/>' +
    '<path fill="none" stroke="#4a4266" stroke-width="0.9" stroke-linecap="round" ' +
    'd="M6.4 7.4c1-.9 2.4-.9 3.4-.2m4.4-.2c1-.7 2.4-.7 3.4.2"/>',
);

/* ------------------------------------------------------------------ */
/* Provider provenance                                                */
/* ------------------------------------------------------------------ */

/**
 * The emote-name tokens each provider contributes to the preview.
 *
 * PROVENANCE IS THE NAME, NOT A DISTINCT DRAW. In production `loadTwitchEmotes`
 * merges FFZ, BTTV and 7TV into one `SevenTVEmote[]` and the renderer word-swaps
 * them identically — there is no per-emote provider field and no separate render
 * path. So "which provider" is expressed the only way the data model expresses
 * it: by the token that provider's loader would have produced. The showcase and
 * the sample cosmetics both read these names, so a fixture and the line that
 * demonstrates it can never drift apart, and all three sit behind the single
 * `sevenTVEmotesEnabled` gate exactly as they do live.
 */
export const PREVIEW_EMOTE_TOKENS = {
  sevenTV: 'OMEGALUL',
  sevenTVAlt: 'KEKW',
  sevenTVZeroWidth: 'RainTime',
  bttv: 'catJAM',
  ffz: 'PepeLaugh',
  nativeTwitch: 'Kappa',
} as const;
