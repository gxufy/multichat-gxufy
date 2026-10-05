/* The preview background's pure serialize/restore pair
 * (components/classic/ClassicPreviewBackgroundControl.tsx).
 *
 * The generator tests exercise these through the DOM — click Custom, leave for
 * OAuth, remount, read the restored radio. That proves the wiring. What it does
 * not isolate is the contract the wiring rests on: that whatever
 * effectivePreviewBackground writes to the draft, previewBackgroundFromDraft
 * reads back to the same mode and colour, and that a value from outside the app
 * (an older draft, a hand-edited one) degrades to Transparent rather than
 * throwing. Those are properties of two small functions, and this tests them as
 * such — no render, no timers.
 *
 * The overriding invariant, checked last: neither function can emit anything
 * shaped like a URL, because a preview backdrop that reached a query string
 * would reach OBS.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREVIEW_CUSTOM_COLOR,
  PREVIEW_BG_MODES,
  effectivePreviewBackground,
  isHexColor,
  previewBackgroundFromDraft,
  previewSurfaceClass,
  type PreviewBgMode,
} from '@/components/classic/ClassicPreviewBackgroundControl';
import { PREVIEW_BACKGROUNDS } from '@/lib/tools/previewBackground';

describe('the mode set', () => {
  it('is the three fixed backdrops plus Custom, in that order', () => {
    expect([...PREVIEW_BG_MODES]).toEqual([...PREVIEW_BACKGROUNDS, 'custom']);
  });

  it('starts on the same Transparent default the previews do', () => {
    /* 'checker' is the id the surface has always carried for the transparent
       checkerboard; the control's default and the generator's initial state
       must agree on it or a fresh preview would start on the wrong backdrop. */
    expect(PREVIEW_BG_MODES[0]).toBe('checker');
  });
});

describe('isHexColor', () => {
  it('accepts a six-digit hex, upper or lower case', () => {
    expect(isHexColor('#123456')).toBe(true);
    expect(isHexColor('#ABCDEF')).toBe(true);
    expect(isHexColor('#abcdef')).toBe(true);
  });

  it('rejects the shapes an <input type=color> never emits', () => {
    /* Three-digit shorthand, a named colour, rgb(), a missing hash and the
       empty string are all things a draft might carry from elsewhere; none is
       what the colour input round-trips, so none should read as Custom. */
    for (const bad of ['#123', 'red', 'rgb(1,2,3)', '123456', '#12345', '#1234567', '']) {
      expect(isHexColor(bad), bad).toBe(false);
    }
  });
});

describe('effectivePreviewBackground — what persists', () => {
  it('writes the mode id for each fixed backdrop, ignoring the custom colour', () => {
    for (const mode of PREVIEW_BACKGROUNDS) {
      expect(effectivePreviewBackground(mode, '#abcdef')).toBe(mode);
    }
  });

  it('writes the chosen colour itself for Custom', () => {
    expect(effectivePreviewBackground('custom', '#123456')).toBe('#123456');
  });
});

describe('previewBackgroundFromDraft — what restores', () => {
  it('restores each fixed backdrop by its id', () => {
    for (const mode of PREVIEW_BACKGROUNDS) {
      expect(previewBackgroundFromDraft(mode)).toEqual({
        mode,
        customColor: DEFAULT_PREVIEW_CUSTOM_COLOR,
      });
    }
  });

  it('restores Custom and its colour from a hex string', () => {
    expect(previewBackgroundFromDraft('#123456')).toEqual({
      mode: 'custom',
      customColor: '#123456',
    });
  });

  it('falls back to Transparent for anything it does not recognise', () => {
    /* An older draft, a hand-edited one, or a future value this build predates:
       none of it should throw or land on a broken mode. Transparent is the safe
       default because it is what a fresh preview shows anyway. */
    for (const junk of ['', 'white', 'rgb(0,0,0)', '#123', 'undefined', 'checkerboard']) {
      expect(previewBackgroundFromDraft(junk)).toEqual({
        mode: 'checker',
        customColor: DEFAULT_PREVIEW_CUSTOM_COLOR,
      });
    }
  });
});

describe('the round trip', () => {
  /* The property the OAuth detour depends on: persist then restore lands back
     on the same mode. For Custom the colour rides along; for the fixed modes the
     restored colour is the default (they do not carry one), which is exactly why
     the parent keeps the colour in its own state rather than in the draft. */
  it('round-trips every fixed mode back to itself', () => {
    for (const mode of PREVIEW_BACKGROUNDS) {
      const restored = previewBackgroundFromDraft(
        effectivePreviewBackground(mode, DEFAULT_PREVIEW_CUSTOM_COLOR),
      );
      expect(restored.mode).toBe(mode);
    }
  });

  it('round-trips a custom colour back to Custom with that colour', () => {
    for (const color of ['#000000', '#ffffff', '#46464e', '#0af0Ac']) {
      const restored = previewBackgroundFromDraft(
        effectivePreviewBackground('custom', color),
      );
      expect(restored.mode).toBe('custom');
      /* Case is preserved verbatim — the input echoes exactly what was stored. */
      expect(restored.customColor).toBe(color);
    }
  });
});

describe('the surface class', () => {
  it('gives each fixed backdrop a modifier class and Custom none', () => {
    /* Custom drives the surface with an inline colour, so it must NOT also carry
       a class — a leftover class would paint over the chosen colour. */
    expect(previewSurfaceClass('checker')).toBe('checkered');
    expect(previewSurfaceClass('dark')).toBe('dark');
    expect(previewSurfaceClass('light')).toBe('light');
    expect(previewSurfaceClass('custom')).toBe('');
  });
});

describe('nothing here is shaped like a URL', () => {
  /* The load-bearing safety property: a preview backdrop must never be able to
     travel in a query string. Neither function should emit a scheme, a query,
     or a path separator — a hex colour and a short id are all they may produce. */
  const persisted = [
    ...PREVIEW_BACKGROUNDS.map((m) => effectivePreviewBackground(m, '#123456')),
    effectivePreviewBackground('custom', '#123456'),
  ];

  it('emits only ids and hex colours, never a URL fragment', () => {
    for (const value of persisted) {
      expect(value).not.toContain('://');
      expect(value).not.toContain('?');
      expect(value).not.toContain('/');
      expect(value).not.toContain('&');
    }
  });
});
