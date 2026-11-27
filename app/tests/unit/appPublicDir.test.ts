/* The site's web/public folder is found from wherever the code runs. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { appPublicDir } from '@/lib/server/appPublicDir';

const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'fc-public-dir-')));
const expected = path.join(root, 'web', 'public');
mkdirSync(expected, { recursive: true });
mkdirSync(path.join(root, 'app'));

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('appPublicDir', () => {
  it('finds web/public from web/ (where the site runs)', () => {
    expect(appPublicDir(path.join(root, 'web'))).toBe(expected);
  });

  it('finds it from the repository root and from app/', () => {
    expect(appPublicDir(root)).toBe(expected);
    expect(appPublicDir(path.join(root, 'app'))).toBe(expected);
  });

  it('names the usual place when there is none, so a missing file fails plainly', () => {
    const empty = realpathSync(mkdtempSync(path.join(tmpdir(), 'fc-public-none-')));
    try {
      expect(appPublicDir(empty)).toBe(path.join(empty, 'web', 'public'));
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('finds the real folder from this test run', () => {
    expect(path.basename(appPublicDir())).toBe('public');
    expect(path.basename(path.dirname(appPublicDir()))).toBe('web');
  });
});
