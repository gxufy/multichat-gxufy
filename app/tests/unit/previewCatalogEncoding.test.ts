import { describe, expect, it } from 'vitest';
import catalog from '@/features/multichat/previewCatalog.compact.json';

/* UTF-8 read back as Latin-1/Windows-1252 ("MÃ¶bius", "OnryÅ\u008d") once
   leaked into the bundled preview catalog and showed up as badge titles. */
const MOJIBAKE = /[Â-Å][\u0080-¿]/;

function strings(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => strings(item, `${path}/${index}`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => strings(item, `${path}/${key}`));
  }
  return [];
}

describe('bundled preview catalog text', () => {
  it('contains no double-encoded UTF-8', () => {
    expect(strings(catalog).filter(([, text]) => MOJIBAKE.test(text))).toEqual([]);
  });

  it('keeps the repaired badge titles', () => {
    const all = strings(catalog).map(([, text]) => text);
    expect(all).toContain('Möbius');
    expect(all).toContain('La Velada del Año IV');
    expect(all).toContain("The Onryō's Mask");
  });
});
