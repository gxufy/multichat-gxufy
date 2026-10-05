/* Import-boundary guards.
 *
 * These enforce the architectural boundaries the src/ reorganization made
 * explicit, by reading source text and asserting no forbidden import string
 * appears. Coarse — a grep guard cannot follow re-exports — but it is the only
 * thing that catches a boundary being crossed by a future edit, and each guard
 * below is mutation-checked (documented inline) so it cannot pass vacuously.
 *
 * The boundaries are real properties of this codebase, not invented for the
 * test: every one holds at the time of writing (verified by the same walk
 * returning an empty offender list), and each maps to a concrete hazard —
 * a secret in a client bundle, the OBS overlay pulling in generator-only
 * preview code, or the Viewer Counter starting Twitch pin polling.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

/** Every .ts/.tsx under a src-relative directory, recursively, as src-relative
 *  POSIX paths (e.g. "components/overlay/ChatOverlay.tsx"). */
function sourceFiles(dir: string): string[] {
  const abs = join(SRC, dir);
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

/** Read the given src-relative files as [path, contents] pairs. */
function read(files: string[]): ReadonlyArray<readonly [string, string]> {
  return files.map((rel) => [rel, readFileSync(join(SRC, rel), 'utf8')] as const);
}

/** Files whose contents match any forbidden import pattern. */
function offenders(
  files: ReadonlyArray<readonly [string, string]>,
  forbidden: RegExp,
): string[] {
  return files.filter(([, src]) => forbidden.test(src)).map(([rel]) => rel);
}

describe('lib/server is server-only', () => {
  /* lib/server holds token crypto, the Supabase service key path, and OAuth
     secrets. If a browser-executed module imports it, that code — and any
     secret it closes over — can land in a client bundle. Client surfaces are
     components, features (generator UI), and the two client-rendered pages;
     the API routes under pages/api and app/api are server-executed and are
     allowed to import it. */
  const CLIENT_DIRS = ['components', 'features'];
  const CLIENT_PAGES = ['pages/multichat.tsx', 'pages/counter.tsx', 'pages/index.tsx'];

  it('is not imported by any client component, feature, or client page', () => {
    const files = [
      ...CLIENT_DIRS.flatMap(sourceFiles),
      ...CLIENT_PAGES,
    ];
    // Mutation check: point any client file's import at '@/lib/server/...'
    // and this list becomes non-empty.
    expect(offenders(read(files), /(?:from|import) '@?\/?.*lib\/server\//)).toEqual([]);
  });

  it('guards a non-empty file set (walk did not silently return nothing)', () => {
    expect(CLIENT_DIRS.flatMap(sourceFiles).length).toBeGreaterThan(10);
  });
});

describe('the OBS overlay does not import generator-only code', () => {
  /* components/overlay holds the two production renderers loaded into an OBS
     browser source. The generator UI (components/classic) and the feature
     preview simulators exist only to power the /multichat generator page and
     must never be pulled into the overlay bundle. */
  it('overlay renderers import neither classic UI nor preview simulators', () => {
    const files = read(sourceFiles('components/overlay'));
    // Mutation check: add `import '@/components/classic/classicStyles'` to
    // ChatOverlay and this fails naming that file.
    expect(offenders(files, /(?:from|import) '@?\/?.*(?:components\/classic|preview\w*Simulator)/))
      .toEqual([]);
  });
});

describe('the Viewer Counter never reaches the Twitch pin path', () => {
  /* The Counter is a separate overlay that must not open a socket or start
     Twitch pin polling — asserted at the request layer elsewhere; here we
     forbid the import statically so a future edit cannot wire it in. Covers
     the counter feature, its production renderer, and the /counter page. */
  it('counter feature, renderer, and page do not import twitchPin*', () => {
    const files = read([
      ...sourceFiles('features/counter'),
      'components/overlay/ViewerCounterDisplay.tsx',
      'pages/counter.tsx',
    ]);
    // Mutation check: import twitchPinPoller into ViewerCounterDisplay -> fails.
    expect(offenders(files, /twitchPin(Poller|Client)/)).toEqual([]);
  });
});

describe('features do not import each other directly', () => {
  /* MultiChat and Counter compose only through features/registry. A direct
     features/multichat <-> features/counter import would couple two overlays
     that ship independently. The registry itself is the composition root and
     is expected to import both, so it is excluded. */
  it('multichat does not import counter and vice versa', () => {
    const mc = read(sourceFiles('features/multichat'));
    const vc = read(sourceFiles('features/counter'));
    // Mutation check: import '@/features/counter/config' into a multichat file.
    expect(offenders(mc, /(?:from|import) '@?\/?.*features\/counter/)).toEqual([]);
    expect(offenders(vc, /(?:from|import) '@?\/?.*features\/multichat/)).toEqual([]);
  });
});
