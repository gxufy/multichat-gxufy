/* Current Classic generator contract.
 *
 * Pins and the Twitch pin-only OAuth surface are retired. The catalog retains
 * hidden compatibility descriptors so old state can normalize safely, while the
 * generator exposes only active controls and always produces pin-free URLs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import { PREVIEW_DEBOUNCE_MS } from '@/components/workspace/OverlayPreviewFrame';
import { COUNTER_SECTION_ID } from '@/lib/multichatRouting';
import { MULTICHAT_COMMANDS, MULTICHAT_COMMAND_TRIGGER } from '@/lib/multichatCommands';
import { MULTICHAT_OBS_RECOMMENDED, MULTICHAT_OBS_SIZE } from '@/features/multichat/obs';
import { multichatTool } from '@/features/multichat/config';
import { counterTool } from '@/features/counter/config';
import { MULTICHAT_CATALOG } from '@/features/multichat/settings';
import { COUNTER_CATALOG } from '@/features/counter/settings';
import { CLASSIC_GENERATOR_CSS } from '@/components/classic/classicStyles';
import { buildMultichatQuery } from '@/lib/multichatConfig';
import { buildViewerCounterQuery } from '@/lib/viewerCounterConfig';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/components/workspace/LiveCounterPreview', () => ({
  default: ({ url, height }: { url: string; height: number }) => (
    <div
      data-testid="counter-live-preview"
      data-overlay-url={url}
      data-preview-height={String(height)}
    />
  ),
}));

const BASE = 'http://localhost:3000';
const mount = (props: { focusCounter?: boolean } = {}) =>
  render(<ClassicGenerator {...props} />);

const panel = (selector: string) => {
  const el = document.querySelector(selector);
  expect(el, `${selector} is missing`).not.toBeNull();
  return el as HTMLElement;
};

const typeChannel = (platform: string, value: string) =>
  fireEvent.change(document.getElementById(`channel-${platform}`)!, {
    target: { value },
  });

const chatUrl = () =>
  within(panel('.panel-chat-output')).getByLabelText('Generated MultiChat overlay URL')
    .textContent ?? '';
const counterUrl = () =>
  within(panel('.panel-counter-output')).getByLabelText('Generated viewer counter URL')
    .textContent ?? '';
const settle = () => act(() => void vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10));

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Classic identity and layout', () => {
  it('renders the branded header, tagline, and four platform chips', () => {
    mount();
    const header = panel('header.header-strip');
    expect(header.textContent).toContain('multichat-gxufy');
    expect(header.textContent).toContain('Every chat. One overlay. No login.');
    expect(header.querySelector('img.header-logo')).not.toBeNull();
    expect(Array.from(header.querySelectorAll('.platform-chip')).map((chip) => chip.textContent))
      .toEqual(['Kick', 'Twitch', 'YouTube', 'TikTok']);
  });

  it('keeps one shared channel card and the six-card tool grid order', () => {
    mount();
    expect(panel('.platform-inputs').querySelectorAll('.platform-input'))
      .toHaveLength(multichatTool.platforms.length);
    const grid = document.querySelector('.tool-grid')!;
    expect(Array.from(grid.children).map((child) => child.className)).toEqual([
      'card panel-chat-output',
      'card panel-chat-settings',
      'card panel-counter-output',
      'card panel-counter-settings',
      'card panel-commands',
      'card panel-obs',
    ]);
  });

  it('keeps equal desktop tool columns and a stacked responsive layout', () => {
    expect(CLASSIC_GENERATOR_CSS).toContain(
      'grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)',
    );
    expect(CLASSIC_GENERATOR_CSS).toContain('"chat-output counter-output"');
    expect(CLASSIC_GENERATOR_CSS).toContain('"chat-settings counter-settings"');
    expect(CLASSIC_GENERATOR_CSS).toContain('"chat-output"');
    expect(CLASSIC_GENERATOR_CSS).toContain('"counter-output"');
  });

  it('keeps the four labelled channel controls without helper copy', () => {
    mount();
    const card = panel('.card.hero');
    for (const platform of ['Kick', 'Twitch', 'YouTube', 'TikTok']) {
      expect(within(card).getByText(platform)).not.toBeNull();
    }
    expect(card.querySelector('.platform-hint')).toBeNull();
  });

  it('links each preview to its matching Pogly marketplace widget with the Pogly logo', () => {
    mount();
    const links = screen.getAllByRole('link', { name: /Pogly Widget/i });
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://widget.pogly.gg/4105',
      'https://widget.pogly.gg/4106',
    ]);
    for (const link of links) {
      const icon = within(link).getByRole('img', { name: 'Pogly' });
      expect(icon.getAttribute('src')).toBe('/images/pogly.png');
      expect(icon.getAttribute('width')).toBe('18');
      expect(icon.getAttribute('height')).toBe('18');
    }
  });
});

describe('catalog-backed controls', () => {
  it('renders every visible MultiChat catalog setting and hides retired pins', () => {
    mount();
    const conditionallyHidden = new Set(['maxMessageLines', 'maxMessageAge']);
    const visible = MULTICHAT_CATALOG.filter(
      (setting) => !setting.hidden && !conditionallyHidden.has(String(setting.key)),
    );
    for (const setting of visible) {
      expect(
        document.getElementById(`mc-${String(setting.key)}`),
        `mc-${String(setting.key)}`,
      ).not.toBeNull();
    }
    expect(document.getElementById('mc-showPinEnabled')).toBeNull();
    expect(document.getElementById('mc-pinPlatforms')).toBeNull();
    expect(document.getElementById('mc-pinPlatforms-kick')).toBeNull();
  });

  it('renders every Viewer Counter setting through its grouped controls', () => {
    mount();
    expect(COUNTER_CATALOG).toHaveLength(13);
    for (const setting of COUNTER_CATALOG) {
      expect(document.getElementById(`vc-${String(setting.key)}`)).not.toBeNull();
    }
  });

  it('gives Counter Typography its own full-width independent control group', () => {
    mount();
    const group = document.getElementById('counter-typography-toggle')!
      .closest('.settings-group')!;
    const body = document.getElementById('counter-typography-body')!;
    expect(group.classList.contains('settings-group-wide')).toBe(true);
    expect(within(body).getByRole('combobox', { name: 'Font' })).not.toBeNull();
    expect(document.getElementById('vc-fontWeight')).not.toBeNull();
    expect(document.getElementById('vc-textTransform')).not.toBeNull();
    expect(document.getElementById('vc-fontItalic')).not.toBeNull();
    expect(document.getElementById('vc-fontColor')).not.toBeNull();
    expect(document.getElementById('vc-textSize-medium')).not.toBeNull();
  });

  it('keeps shared setting ids namespaced between chat and counter', () => {
    mount();
    for (const shared of ['stroke', 'textShadow']) {
      expect(document.getElementById(`mc-${shared}`)).not.toBeNull();
      expect(document.getElementById(`vc-${shared}`)).not.toBeNull();
    }
  });

  it('shows the community-badge toggle and defaults it on', () => {
    mount();
    const control = document.getElementById('mc-showCommunityBadges') as HTMLInputElement;
    expect(control).not.toBeNull();
    expect(control.type).toBe('checkbox');
    expect(control.checked).toBe(true);
    expect(
      document.querySelector('label[for="mc-showCommunityBadges"]')?.textContent,
    ).toBe('Show community badges');
  });

  it('reveals fade duration only while fading is enabled', () => {
    mount();
    expect(document.getElementById('mc-fade')).not.toBeNull();
    fireEvent.click(document.getElementById('mc-fadeEnabled')!);
    expect(document.getElementById('mc-fade')).toBeNull();
  });

  it('keeps pin and Twitch connection UI unreachable', () => {
    mount();
    expect(document.querySelector('.classic-conn')).toBeNull();
    expect(document.querySelector('.mc-pin-connect')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Connect Twitch account' })).toBeNull();
  });

  it('organizes the replacement Typography controls without legacy duplicates', () => {
    mount();
    const textGroup = document.getElementById('chat-text-toggle')!.closest('.settings-group')!;
    const textBody = document.getElementById('chat-text-body')!;
    expect(textGroup.classList.contains('settings-group-wide')).toBe(true);
    expect(textBody.classList.contains('text-settings-layout')).toBe(true);
    expect(within(textBody).getByRole('heading', { name: 'Typography' })).not.toBeNull();
    expect(within(textBody).getByRole('combobox', { name: 'Font' })).not.toBeNull();
    expect(document.getElementById('mc-fontWeight')).not.toBeNull();
    expect(document.getElementById('mc-textTransform')).not.toBeNull();
    expect(document.getElementById('mc-fontItalic')).not.toBeNull();
    expect(document.getElementById('mc-smallCaps')).toBeNull();
    expect(document.getElementById('mc-fontColor')).not.toBeNull();
    expect(document.getElementById('mc-textSizePx')).toBeNull();
    expect(document.getElementById('mc-textSizePx-range')).toBeNull();
    expect(document.getElementById('mc-textSize')).not.toBeNull();
    expect(document.getElementById('mc-textSize-small')).not.toBeNull();
    expect(document.getElementById('mc-textSize-medium')).not.toBeNull();
    expect(document.getElementById('mc-textSize-large')).not.toBeNull();
    expect(document.getElementById('mc-msgCaps')).toBeNull();
    expect(within(textBody).queryByText('Choose the base font family.')).toBeNull();
    expect(within(textBody).queryByText('Choose the base text weight.')).toBeNull();
  });

  it('renders labels but no visible per-setting or per-section helper descriptions', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Chat settings' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Counter settings' })).not.toBeNull();
    expect(screen.getByLabelText('Smooth message scroll')).not.toBeNull();
    expect(screen.getByLabelText('Custom Google Font')).not.toBeNull();

    expect(document.querySelector('.typography-help')).toBeNull();
    expect(document.querySelector('.platform-hint')).toBeNull();
    expect(document.querySelector('.preview-content-sub')).toBeNull();
    expect(document.querySelector('.panel-chat-settings .card-note')).toBeNull();
    expect(document.querySelector('.panel-counter-settings .card-note')).toBeNull();
    expect(screen.queryByText('Font family, weight, and text styling')).toBeNull();
    expect(screen.queryByText(/Optional Google Fonts family name/)).not.toBeNull();
    expect(screen.getByText(/Optional Google Fonts family name/).classList).toContain('sr-only');
  });
});

describe('settings resets', () => {
  it('restores Chat defaults without changing channel or Counter state', () => {
    mount();
    typeChannel('kick', 'gxufy');
    fireEvent.click(document.getElementById('mc-showCommunityBadges')!);
    fireEvent.click(document.getElementById('vc-combined')!);
    const changedCounter = counterUrl();

    fireEvent.click(screen.getByRole('button', { name: 'Reset Chat Settings to Default' }));

    expect((document.getElementById('mc-showCommunityBadges') as HTMLInputElement).checked)
      .toBe(true);
    expect(chatUrl()).toContain('kick=gxufy');
    expect(chatUrl()).not.toContain('showCommunityBadges=false');
    expect(counterUrl()).toBe(changedCounter);
  });

  it('restores the exact legacy Counter typography, background, and shadow defaults', () => {
    mount();
    typeChannel('twitch', 'gxufy');
    fireEvent.click(document.getElementById('vc-bg')!);
    fireEvent.click(document.getElementById('vc-textShadow-none')!);
    const font = document.getElementById('vc-font')!;
    fireEvent.change(font, { target: { value: 'Press Start 2P' } });
    fireEvent.click(screen.getByRole('option', { name: 'Press Start 2P' }));
    fireEvent.change(document.getElementById('vc-fontWeight')!, { target: { value: '500' } });
    fireEvent.click(document.getElementById('vc-textSize-large')!);

    fireEvent.click(screen.getByRole('button', { name: 'Reset Viewer Settings to Default' }));

    expect((document.getElementById('vc-bg') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('vc-textShadow-large') as HTMLInputElement).checked)
      .toBe(true);
    expect((document.getElementById('vc-googleFont') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('vc-font') as HTMLInputElement).value).toBe('DejaVu Sans');
    expect((document.getElementById('vc-fontWeight') as HTMLSelectElement).value).toBe('700');
    expect((document.getElementById('vc-textSize-medium') as HTMLInputElement).checked).toBe(true);
    expect(counterUrl()).toContain('twitch=gxufy');
    expect(counterUrl()).not.toContain('font=');
    expect(counterUrl()).not.toContain('counterFont');
    expect(counterUrl()).not.toContain('counterTextSize');
  });
});

describe('authoritative generated URLs', () => {
  it('builds the chat URL with the MultiChat serializer', () => {
    mount();
    typeChannel('kick', 'somechannel');
    expect(chatUrl()).toBe(
      `${BASE}/multichat?${buildMultichatQuery(
        { kick: 'somechannel', twitch: '', youtube: '', tiktok: '' },
        multichatTool.defaults,
      )}`,
    );
  });

  it('builds the counter URL with the Counter serializer', () => {
    mount();
    typeChannel('kick', 'somechannel');
    expect(counterUrl()).toBe(
      `${BASE}/counter?${buildViewerCounterQuery(
        { kick: 'somechannel' },
        counterTool.defaults,
      )}`,
    );
  });

  it('serializes a searchable preset font exactly as the previous select did', () => {
    mount();
    typeChannel('kick', 'somechannel');
    const font = document.getElementById('mc-font') as HTMLInputElement;

    fireEvent.change(font, { target: { value: 'Lato' } });
    fireEvent.click(screen.getByRole('option', { name: 'Lato' }));

    expect(new URL(chatUrl()).searchParams.get('font')).toBe('lato');
    expect((document.getElementById('mc-googleFont') as HTMLInputElement).value).toBe('');
  });

  it('serializes a suggested Google Font through the existing font parameter', () => {
    mount();
    typeChannel('kick', 'somechannel');
    const font = document.getElementById('mc-font') as HTMLInputElement;
    const fontBeforeSearch = new URL(chatUrl()).searchParams.get('font');

    fireEvent.change(font, { target: { value: 'mont' } });
    expect(new URL(chatUrl()).searchParams.get('font')).toBe(fontBeforeSearch);
    fireEvent.click(screen.getByRole('option', { name: 'Montserrat' }));

    expect(new URL(chatUrl()).searchParams.get('font')).toBe('google:Montserrat');
    expect((document.getElementById('mc-googleFont') as HTMLInputElement).value)
      .toBe('Montserrat');
  });

  it('makes the existing custom Google Font override visible and safely clearable', () => {
    mount();
    typeChannel('kick', 'somechannel');
    const custom = screen.getByRole('textbox', { name: 'Custom Google Font' });
    expect(custom.getAttribute('placeholder')).toBe('Press Start 2P');

    fireEvent.change(custom, { target: { value: 'Press Start 2P' } });
    expect(new URL(chatUrl()).searchParams.get('font')).toBe('google:Press Start 2P');

    fireEvent.change(custom, { target: { value: '' } });
    expect(new URL(chatUrl()).searchParams.get('font')).toBe('opensans');
    expect((document.getElementById('mc-font') as HTMLInputElement).value).toBe('Open Sans');
  });

  it('serializes Typography styling and restores its omission defaults', () => {
    mount();
    typeChannel('kick', 'somechannel');

    fireEvent.change(document.getElementById('mc-fontWeight')!, {
      target: { value: '600' },
    });
    fireEvent.click(document.getElementById('mc-textTransform-lowercase')!);
    fireEvent.click(document.getElementById('mc-fontItalic')!);
    fireEvent.change(document.getElementById('mc-fontColor')!, {
      target: { value: '#abcdef' },
    });
    fireEvent.click(document.getElementById('mc-textSize-large')!);

    const changed = new URL(chatUrl()).searchParams;
    expect(changed.get('fontWeight')).toBe('600');
    expect(changed.get('textTransform')).toBe('lowercase');
    expect(changed.get('fontItalic')).toBe('true');
    expect(changed.get('fontColor')).toBe('abcdef');
    expect(changed.has('smallCaps')).toBe(false);
    expect(changed.has('textSizePx')).toBe(false);
    expect(changed.get('textSize')).toBe('large');

    fireEvent.click(screen.getByRole('button', { name: 'Reset Chat Settings to Default' }));
    const reset = new URL(chatUrl()).searchParams;
    for (const param of [
      'fontWeight', 'textTransform', 'fontItalic', 'smallCaps', 'fontColor', 'textSizePx',
    ]) {
      expect(reset.has(param), param).toBe(false);
    }
    expect((document.getElementById('mc-fontWeight') as HTMLSelectElement).value).toBe('800');
    expect((document.getElementById('mc-textSize-medium') as HTMLInputElement).checked).toBe(true);
  });

  it('maps Transform uppercase to msgCaps and serializes the new modes distinctly', () => {
    mount();
    typeChannel('kick', 'somechannel');

    fireEvent.click(document.getElementById('mc-textTransform-uppercase')!);
    let params = new URL(chatUrl()).searchParams;
    expect(params.get('msgCaps')).toBe('true');
    expect(params.has('textTransform')).toBe(false);

    fireEvent.click(document.getElementById('mc-textTransform-capitalize')!);
    params = new URL(chatUrl()).searchParams;
    expect(params.has('msgCaps')).toBe(false);
    expect(params.get('textTransform')).toBe('capitalize');

    fireEvent.click(document.getElementById('mc-textTransform-none')!);
    params = new URL(chatUrl()).searchParams;
    expect(params.has('msgCaps')).toBe(false);
    expect(params.has('textTransform')).toBe(false);
  });

  it('keeps the Text Size field and slider synchronized within 24–64px', () => {
    mount();
    typeChannel('kick', 'somechannel');
    expect((document.getElementById('mc-textSize-medium') as HTMLInputElement).checked).toBe(true);

    for (const size of ['small', 'medium', 'large'] as const) {
      fireEvent.click(document.getElementById(`mc-textSize-${size}`)!);
      const params = new URL(chatUrl()).searchParams;
      expect(params.get('textSize')).toBe(size);
      expect(params.has('textSizePx')).toBe(false);
    }
  });

  it('community-badge opt-out reaches the chat URL only', () => {
    mount();
    typeChannel('kick', 'somechannel');
    const counterBefore = counterUrl();
    fireEvent.click(document.getElementById('mc-showCommunityBadges')!);
    expect(chatUrl()).toContain('showCommunityBadges=false');
    expect(counterUrl()).toBe(counterBefore);
  });

  it('controls main animation and the separate Off, Right, and Left entrance', () => {
    mount();
    typeChannel('kick', 'somechannel');

    const none = document.getElementById('mc-animation-none') as HTMLInputElement;
    const slide = document.getElementById('mc-animation-slide') as HTMLInputElement;
    const fade = document.getElementById('mc-animation-fade') as HTMLInputElement;

    expect(none).not.toBeNull();
    expect(slide).not.toBeNull();
    expect(fade).not.toBeNull();
    const entranceOff = document.getElementById('mc-entryAnimation-none') as HTMLInputElement;
    const entranceRight = document.getElementById('mc-entryAnimation-slideRight') as HTMLInputElement;
    const entranceLeft = document.getElementById('mc-entryAnimation-slideLeft') as HTMLInputElement;
    expect(entranceOff).not.toBeNull();
    expect(entranceRight).not.toBeNull();
    expect(entranceLeft).not.toBeNull();
    expect(document.getElementById('mc-msgSlideIn')).toBeNull();
    expect(screen.queryByText('New messages slide in from the right')).toBeNull();

    expect(slide.checked).toBe(true);
    expect(new URL(chatUrl()).searchParams.get('animation')).toBe('slide');

    fireEvent.click(fade);
    expect(fade.checked).toBe(true);
    expect(new URL(chatUrl()).searchParams.get('animation')).toBe('fade');

    fireEvent.click(none);
    expect(none.checked).toBe(true);
    expect(new URL(chatUrl()).searchParams.get('animation')).toBe('none');

    fireEvent.click(slide);
    expect(slide.checked).toBe(true);
    expect(new URL(chatUrl()).searchParams.get('animation')).toBe('slide');
    expect(new URL(chatUrl()).searchParams.has('entryAnimation')).toBe(false);
    expect(new URL(chatUrl()).searchParams.has('msgSlideIn')).toBe(false);

    fireEvent.click(entranceRight);
    expect(entranceRight.checked).toBe(true);
    expect(new URL(chatUrl()).searchParams.get('entryAnimation')).toBe('slideRight');
    expect(new URL(chatUrl()).searchParams.get('animation')).toBe('slide');

    fireEvent.click(entranceLeft);
    expect(new URL(chatUrl()).searchParams.get('entryAnimation')).toBe('slideLeft');

    fireEvent.click(entranceOff);
    expect(new URL(chatUrl()).searchParams.has('entryAnimation')).toBe(false);
  });

  it('controls reply presentation and omits only the Full default from the URL', () => {
    mount();
    typeChannel('kick', 'somechannel');

    const full = document.getElementById('mc-replyStyle-full') as HTMLInputElement;
    const mention = document.getElementById('mc-replyStyle-mention') as HTMLInputElement;
    const off = document.getElementById('mc-replyStyle-off') as HTMLInputElement;

    expect(full.checked).toBe(true);
    expect(new URL(chatUrl()).searchParams.has('replyStyle')).toBe(false);

    fireEvent.click(mention);
    expect(new URL(chatUrl()).searchParams.get('replyStyle')).toBe('mention');

    fireEvent.click(off);
    expect(new URL(chatUrl()).searchParams.get('replyStyle')).toBe('off');

    fireEvent.click(full);
    expect(new URL(chatUrl()).searchParams.has('replyStyle')).toBe(false);
  });

  it('keeps reload restoration opt-in and resets it back off', () => {
    mount();
    typeChannel('kick', 'somechannel');
    const control = document.getElementById('mc-restoreOnReload') as HTMLInputElement;

    expect(control.checked).toBe(false);
    expect(new URL(chatUrl()).searchParams.has('restoreOnReload')).toBe(false);

    fireEvent.click(control);
    expect(control.checked).toBe(true);
    expect(new URL(chatUrl()).searchParams.get('restoreOnReload')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Reset Chat Settings to Default' }));
    expect(control.checked).toBe(false);
    expect(new URL(chatUrl()).searchParams.has('restoreOnReload')).toBe(false);
  });

  it('shows restore-history limits only while restoration is enabled', () => {
    mount();
    typeChannel('kick', 'somechannel');

    const restore = document.getElementById('mc-restoreOnReload') as HTMLInputElement;

    expect(document.getElementById('mc-maxMessageLines')).toBeNull();
    expect(document.getElementById('mc-maxMessageAge')).toBeNull();

    fireEvent.click(restore);

    const lines = document.getElementById('mc-maxMessageLines') as HTMLInputElement;
    const age = document.getElementById('mc-maxMessageAge') as HTMLInputElement;

    expect(lines).not.toBeNull();
    expect(age).not.toBeNull();
    expect(lines.value).toBe('100');
    expect(age.value).toBe('');

    let params = new URL(chatUrl()).searchParams;
    expect(params.get('restoreOnReload')).toBe('true');
    expect(params.has('maxMessageLines')).toBe(false);
    expect(params.has('maxMessageAge')).toBe(false);

    fireEvent.change(lines, { target: { value: '25' } });
    fireEvent.change(age, { target: { value: '300' } });

    params = new URL(chatUrl()).searchParams;
    expect(params.get('maxMessageLines')).toBe('25');
    expect(params.get('maxMessageAge')).toBe('300');

    fireEvent.click(restore);

    expect(document.getElementById('mc-maxMessageLines')).toBeNull();
    expect(document.getElementById('mc-maxMessageAge')).toBeNull();

    params = new URL(chatUrl()).searchParams;
    expect(params.has('restoreOnReload')).toBe(false);
    expect(params.has('maxMessageLines')).toBe(false);
    expect(params.has('maxMessageAge')).toBe(false);
  });

  it('badge visibility updates the chat URL and resets with Chat defaults', () => {
    mount();
    typeChannel('kick', 'somechannel');

    fireEvent.click(screen.getByRole('button', { name: 'Hide FFZ badges' }));

    expect(new URL(chatUrl()).searchParams.get('badgeLayout')).toContain('!ffz');
    expect(screen.getByRole('button', { name: 'Show FFZ badges' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reset Chat Settings to Default' }));

    expect(new URL(chatUrl()).searchParams.has('badgeLayout')).toBe(false);
    expect(screen.getByRole('button', { name: 'Hide FFZ badges' })).not.toBeNull();
  });

  it('never emits retired pin params or a connection fragment', () => {
    mount();
    typeChannel('twitch', 'somechannel');
    expect(chatUrl()).not.toContain('showPinEnabled');
    expect(chatUrl()).not.toContain('pinPlatforms');
    expect(chatUrl()).not.toContain('#');
  });

  it('uses the production preview URLs after debounce', () => {
    mount();
    typeChannel('kick', 'somechannel');
    fireEvent.click(screen.getByRole('tab', { name: 'Live Overlay' }));
    settle();
    expect(
      document.querySelector('iframe[title="Live chat overlay preview"]')?.getAttribute('src'),
    ).toBe(chatUrl());
    expect(
      document.querySelector('[data-testid="counter-live-preview"]')
        ?.getAttribute('data-overlay-url'),
    ).toBe(counterUrl());
  });
});

describe('Copy and Open', () => {
  it('copies and opens exactly the displayed chat URL', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    mount();
    typeChannel('kick', 'somechannel');
    const scope = within(panel('.panel-chat-output'));
    fireEvent.click(scope.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(chatUrl());
    expect(scope.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(chatUrl());
  });

  it('copies and opens exactly the displayed counter URL', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    mount();
    typeChannel('kick', 'somechannel');
    const scope = within(panel('.panel-counter-output'));
    fireEvent.click(scope.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(counterUrl());
    expect(scope.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(counterUrl());
  });
});

describe('preview backgrounds', () => {
  const bgRadio = (region: 'chat' | 'counter', option: string) =>
    document.getElementById(`${region}-preview-bg-${option}`) as HTMLInputElement;

  it('starts both previews transparent/checker and keeps them independent', () => {
    mount();
    expect(bgRadio('chat', 'checker').checked).toBe(true);
    expect(bgRadio('counter', 'checker').checked).toBe(true);
    fireEvent.click(bgRadio('chat', 'dark'));
    expect(bgRadio('chat', 'dark').checked).toBe(true);
    expect(bgRadio('counter', 'checker').checked).toBe(true);
  });

  it('never serializes preview-only backgrounds', () => {
    mount();
    typeChannel('kick', 'somechannel');
    const before = [chatUrl(), counterUrl()];
    fireEvent.click(bgRadio('chat', 'dark'));
    fireEvent.click(bgRadio('counter', 'light'));
    expect([chatUrl(), counterUrl()]).toEqual(before);
  });
});

describe('Commands and OBS help', () => {
  it('documents every implemented command and the real trigger', () => {
    mount();
    const region = panel('[aria-labelledby="commands-heading"]');
    const rows = Array.from(region.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(MULTICHAT_COMMANDS.length);
    expect(rows.map((row) => row.querySelector('td')?.textContent))
      .toEqual(MULTICHAT_COMMANDS.map((command) => command.syntax));
    expect(region.textContent).toContain(MULTICHAT_COMMAND_TRIGGER);
  });

  it('documents two separate OBS browser sources and only the recommended chat size', () => {
    mount();
    const text = panel('[aria-labelledby="obs-heading"]').textContent ?? '';
    expect(text).toMatch(/two separate browser sources/i);
    expect(text).toContain(
      `${MULTICHAT_OBS_RECOMMENDED.width} × ${MULTICHAT_OBS_RECOMMENDED.height}`,
    );
    expect(text).not.toContain(`${MULTICHAT_OBS_SIZE.width} × ${MULTICHAT_OBS_SIZE.height}`);
    expect(text).toContain(`${counterTool.obs.width} × ${counterTool.obs.height}`);
  });
});

describe('accessibility', () => {
  it('offers a skip link, one h1, and labelled channel inputs', () => {
    mount();
    expect(screen.getByRole('link', { name: 'Skip to the generator' }).getAttribute('href'))
      .toBe('#generator-main');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    for (const platform of multichatTool.platforms) {
      const field = document.getElementById(`channel-${platform.key}`)!;
      expect(document.querySelector(`label[for="${field.id}"]`)).not.toBeNull();
    }
  });

  it('keeps the counter output anchor and scrolls there when requested', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    });
    mount({ focusCounter: true });
    expect(panel('.panel-counter-output').id).toBe(COUNTER_SECTION_ID);
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
