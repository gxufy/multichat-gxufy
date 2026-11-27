/* The retired generator addresses (/tools/multichat, /tools/counter,
 * /classic/multichat): one rule for where each forwards, used by both apps'
 * pages. */
import { describe, expect, it } from 'vitest';
import { TOOL_IDS } from '@/features/registry';
import { CANONICAL_COUNTER_ROUTE, CANONICAL_MULTICHAT_ROUTE } from '@/lib/multichatRouting';
import {
  RETIRED_TOOL_DESTINATIONS,
  classicGeneratorTarget,
  isConnectionFragment,
  retiredToolDestination,
  retiredToolTarget,
} from '@/lib/retiredRoutes';

describe('retired tool pages', () => {
  it('cover exactly the registered tools', () => {
    /* The /tools/[tool] page has only this table, so it must name every
       registered tool and nothing else. */
    expect(Object.keys(RETIRED_TOOL_DESTINATIONS).sort()).toEqual([...TOOL_IDS].sort());
  });

  it('send each to where its tool now lives', () => {
    expect(retiredToolDestination('multichat')).toBe(CANONICAL_MULTICHAT_ROUTE);
    expect(retiredToolDestination('counter')).toBe(CANONICAL_COUNTER_ROUTE);
  });

  it('never existed for any other name, inherited ones included', () => {
    for (const id of ['unknown', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'Multichat', '', undefined]) {
      expect(retiredToolDestination(id), String(id)).toBeNull();
    }
  });
});

describe('the fragment a retired page was opened with', () => {
  it('is a connection payload when it holds key=value pairs', () => {
    expect(isConnectionFragment('#connection=abc')).toBe(true);
    expect(isConnectionFragment('connection=abc&x=1')).toBe(true);
    expect(isConnectionFragment('#viewer-counter')).toBe(false);
    expect(isConnectionFragment('')).toBe(false);
  });

  it('is carried to the generator when it is a payload, and dropped when it is an anchor', () => {
    expect(retiredToolTarget(CANONICAL_COUNTER_ROUTE, '#connection=abc')).toBe(`${CANONICAL_MULTICHAT_ROUTE}#connection=abc`);
    expect(retiredToolTarget(CANONICAL_COUNTER_ROUTE, '#somewhere')).toBe(CANONICAL_COUNTER_ROUTE);
    expect(retiredToolTarget(CANONICAL_COUNTER_ROUTE, '')).toBe(CANONICAL_COUNTER_ROUTE);
    expect(retiredToolTarget(CANONICAL_MULTICHAT_ROUTE, '')).toBe(CANONICAL_MULTICHAT_ROUTE);
  });

  it('always goes along from /classic/multichat', () => {
    expect(classicGeneratorTarget('')).toBe(CANONICAL_MULTICHAT_ROUTE);
    expect(classicGeneratorTarget('#connection=abc')).toBe(`${CANONICAL_MULTICHAT_ROUTE}#connection=abc`);
    expect(classicGeneratorTarget('#anchor')).toBe(`${CANONICAL_MULTICHAT_ROUTE}#anchor`);
  });
});
