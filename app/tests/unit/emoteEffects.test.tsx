import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BTTV_EMOTE_EFFECT_TOKENS,
  FFZ_EMOTE_EFFECT_TOKENS,
  renderMessageText,
} from '@/lib/render';
import type { SevenTVEmote } from '@/lib/kick';
import type { UnifiedMessage } from '@/lib/types';

const effectClass = {
  squishX: 'gx-emote-effect-squish-x',
  wide: 'gx-emote-effect-wide',
  flipX: 'gx-emote-effect-flip-x',
  flipY: 'gx-emote-effect-flip-y',
  shake: 'gx-emote-effect-shake',
  rotateRight: 'gx-emote-effect-rotate-right',
  rotateLeft: 'gx-emote-effect-rotate-left',
  rotateHalf: 'gx-emote-effect-rotate-half',
  rainbow: 'gx-emote-effect-rainbow',
  halfFlipX: 'gx-emote-effect-half-flip-x',
  cursed: 'gx-emote-effect-cursed',
  hyper: 'gx-emote-effect-hyper',
  slide: 'gx-emote-effect-slide',
  jam: 'gx-emote-effect-jam',
  bounce: 'gx-emote-effect-bounce',
  spin: 'gx-emote-effect-spin',
  arrive: 'gx-emote-effect-arrive',
  leave: 'gx-emote-effect-leave',
} as const;

const emotes: SevenTVEmote[] = [
  {
    name: 'OMEGALUL',
    image: 'https://cdn.example.com/omegalul.webp',
    height: 32,
    width: 32,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'OVERLAY',
    image: 'https://cdn.example.com/overlay.webp',
    height: 32,
    width: 32,
    zeroWidth: true,
    upscale: false,
  },
];

function message(text: string, native = false): UnifiedMessage {
  return {
    platform: 'twitch',
    id: 'effects',
    senderId: '1',
    username: 'viewer',
    color: '#fff',
    badges: [],
    text,
    emotes: native ? [{ begin: 3, end: 8, text: 'Kappa', url: 'https://cdn.example.com/kappa.png' }] : [],
    timestamp: 1,
    kind: 'chat',
  };
}

function mount(text: string, catalog = emotes, native = false) {
  return render(<div>{renderMessageText(message(text, native), catalog)}</div>);
}

describe('built-in BTTV and FFZ emote effects', () => {
  it('applies FFZ modifiers backward and removes the modifier text', () => {
    const view = mount('OMEGALUL ffzSpin');
    const unit = view.container.querySelector('[data-emote-effect-provider="ffz"]')!;
    expect(unit.querySelector('.gx-emote-effect-spin')).toBeTruthy();
    expect(view.container.textContent).not.toContain('ffzSpin');
  });

  it('applies BTTV modifiers forward and removes the modifier text', () => {
    const view = mount('w! OMEGALUL');
    const unit = view.container.querySelector('[data-emote-effect-provider="bttv"]')!;
    expect(unit.querySelector('.gx-emote-effect-wide')).toBeTruthy();
    expect(view.container.textContent).not.toContain('w!');
  });

  it('stacks multiple compatible modifiers as nested wrappers', () => {
    const view = mount('v! r! OMEGALUL');
    const unit = view.container.querySelector('[data-emote-effect-provider="bttv"]')!;
    expect(unit.querySelector('.gx-emote-effect-flip-x')).toBeTruthy();
    expect(unit.querySelector('.gx-emote-effect-rotate-right')).toBeTruthy();
  });

  it('uses BTTV behavior when both modifier families target the same emote', () => {
    const view = mount('w! OMEGALUL ffzSpin');
    const unit = view.container.querySelector('[data-emote-effect-provider="bttv"]')!;
    expect(unit.querySelector('.gx-emote-effect-wide')).toBeTruthy();
    expect(unit.querySelector('.gx-emote-effect-spin')).toBeNull();
    expect(view.container.textContent).not.toContain('ffzSpin');
  });

  it('wraps a zero-width stack as one effectable visual unit', () => {
    const view = mount('OMEGALUL OVERLAY ffzBounce');
    const unit = view.container.querySelector('[data-emote-effect-provider="ffz"]')!;
    expect(unit.querySelectorAll('.ck-zw')).toHaveLength(1);
    expect(unit.querySelectorAll('.ck-emote')).toHaveLength(2);
    expect(unit.querySelector('.gx-emote-effect-bounce')).toBeTruthy();
  });

  it('can target a provider-native Twitch emote without changing its offsets', () => {
    const view = mount('w! Kappa', [], true);
    const unit = view.container.querySelector('[data-emote-effect-provider="bttv"]')!;
    expect(unit.querySelector('.ck-native-twitch')).toBeTruthy();
  });

  it('leaves ordinary messages on the established renderer path', () => {
    const view = mount('hello OMEGALUL world');
    expect(view.container.textContent).toBe('hello  world');
    expect(view.container.querySelector('[data-emote-effect-provider]')).toBeNull();
    expect(view.container.querySelector('img.ck-emote')?.getAttribute('alt')).toBe('OMEGALUL');
  });

  it('keeps an effect alias visible when no emote can receive it', () => {
    const view = mount('just words ffzSpin', []);
    expect(view.container.textContent).toContain('ffzSpin');
  });

  it('consumes every supported alias when it reaches an emote', () => {
    for (const [token, effect] of Object.entries(BTTV_EMOTE_EFFECT_TOKENS)) {
      const view = mount(`${token} OMEGALUL`);
      expect(view.container.textContent).not.toContain(token);
      const unit = view.container.querySelector('[data-emote-effect-provider="bttv"]')!;
      expect(unit.querySelector(`.${effectClass[effect]}`)).toBeTruthy();
      expect(unit.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/omegalul.webp');
      view.unmount();
    }
    for (const [token, effect] of Object.entries(FFZ_EMOTE_EFFECT_TOKENS)) {
      const view = mount(`OMEGALUL ${token}`);
      expect(view.container.textContent).not.toContain(token);
      const unit = view.container.querySelector('[data-emote-effect-provider="ffz"]')!;
      expect(unit.querySelector(`.${effectClass[effect]}`)).toBeTruthy();
      expect(unit.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/omegalul.webp');
      view.unmount();
    }
  });

  it('repaints a late-loaded community emote and applies its modifier without moving adjacent text', () => {
    const raw = message('before OMEGALUL ffzSpin after');
    const view = render(<div>{renderMessageText(raw, [])}</div>);
    expect(view.container.textContent).toBe('before OMEGALUL ffzSpin after');
    expect(view.container.querySelector('[data-emote-effect-provider]')).toBeNull();

    view.rerender(<div>{renderMessageText(raw, emotes)}</div>);
    expect(view.container.textContent?.replace(/\s+/g, ' ').trim()).toBe('before after');
    expect(view.container.querySelector('[data-emote-effect-provider="ffz"] .gx-emote-effect-spin')).toBeTruthy();
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/omegalul.webp');
  });

  it('reconstructs effects from restored raw message text without persisting renderer state', () => {
    const restored = JSON.parse(JSON.stringify(message('w! OMEGALUL'))) as UnifiedMessage;
    const view = render(<div>{renderMessageText(restored, emotes)}</div>);
    expect(view.container.querySelector('[data-emote-effect-provider="bttv"] .gx-emote-effect-wide')).toBeTruthy();
    expect(view.container.textContent).not.toContain('w!');
  });

  it('keeps malformed and unsupported effect-like text visible without damaging nearby emotes', () => {
    const view = mount('ffzSpinny OMEGALUL q!');
    expect(view.container.textContent).toContain('ffzSpinny');
    expect(view.container.textContent).toContain('q!');
    expect(view.container.querySelector('[data-emote-effect-provider]')).toBeNull();
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/omegalul.webp');
  });

  it('keeps mixed native Twitch and community emotes independently targetable', () => {
    const raw = message('w! Kappa OMEGALUL ffzSpin', true);
    const view = render(<div>{renderMessageText(raw, emotes)}</div>);
    const units = view.container.querySelectorAll('[data-emote-effect-provider]');
    expect(units).toHaveLength(2);
    expect(units[0]?.getAttribute('data-emote-effect-provider')).toBe('bttv');
    expect(units[0]?.querySelector('.ck-native-twitch')).toBeTruthy();
    expect(units[1]?.getAttribute('data-emote-effect-provider')).toBe('ffz');
    expect(units[1]?.querySelector('img[alt="OMEGALUL"]')).toBeTruthy();
  });
});
