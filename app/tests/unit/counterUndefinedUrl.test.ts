/* No generated Counter URL may contain the literal string 'undefined'. */
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { buildViewerCounterQuery } from '@/lib/viewerCounterConfig';

const EVIDENCE =
  'kick=iceposeidon&combined=undefined&icons=undefined&bg=undefined' +
  '&textShadow=small&stroke=none&align=undefined';

function expectNoUndefined(url: string, label: string) {
  expect(url, `${label}: =undefined`).not.toContain('=undefined');
  expect(url, `${label}: undefined&`).not.toContain('undefined&');
  expect(url, `${label}: ?undefined`).not.toContain('?undefined');
  expect(url, `${label}: bare word`).not.toContain('undefined');
}

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('historical reproduction', () => {
  it('reproduces the old undefined string from the former direct String() path', () => {
    const params = new URLSearchParams({ kick: 'iceposeidon' });
    const partial: Record<string, unknown> = {
      textShadow: 'small',
      stroke: 'none',
    };
    params.set('combined', String(partial.combined));
    params.set('icons', String(partial.icons));
    params.set('bg', String(partial.bg));
    params.set('textShadow', partial.textShadow as string);
    params.set('stroke', partial.stroke as string);
    params.set('align', String(partial.align));
    expect(params.toString()).toBe(EVIDENCE);
  });

  it('normalizes a partial style before serialization', () => {
    const produced = buildViewerCounterQuery(
      { kick: 'iceposeidon' },
      { textShadow: 'small', stroke: 'none' },
    );
    expect(produced).not.toBe(EVIDENCE);
    expectNoUndefined(produced, 'serializer with partial style');
    expect(produced).toContain('combined=true');
    expect(produced).toContain('icons=true');
    expect(produced).toContain('bg=false');
    /* Explicit valid partial values remain explicit. */
    expect(produced).toContain('textShadow=small');
  });

  it('an entirely empty style receives all current defaults', () => {
    expect(buildViewerCounterQuery({ kick: 'iceposeidon' }, {})).toBe(
      'kick=iceposeidon&combined=true&icons=true&bg=false&textShadow=large&stroke=none',
    );
  });
});
