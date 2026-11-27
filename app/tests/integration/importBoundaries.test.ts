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
 * preview code, or one overlay importing another feature directly.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

/** Every .ts/.tsx under a src-relative directory, recursively, as src-relative
 *  POSIX paths (e.g. "lib/render/domParts.ts"). */
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

/* The web app (web/src), which draws everything visitors see. */
const WEB_SRC = join(process.cwd(), '..', 'web', 'src');

/** Every .ts/.svelte under a web/src-relative directory, recursively, tests left out. */
function webFiles(dir: string): string[] {
  return readdirSync(join(WEB_SRC, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return webFiles(rel);
    return /\.(ts|svelte)$/.test(entry.name) && !/\.(spec|test)\./.test(entry.name) ? [rel] : [];
  });
}

/** The web app's code that can run in the browser: everything but its server files. */
function webBrowserFiles(): ReadonlyArray<readonly [string, string]> {
  return webFiles('')
    .filter((rel) => !/(^|\/)(lib\/server\/|\+server\.ts$|[^/]*\.server\.ts$)/.test(rel))
    .map((rel) => [`web/src/${rel}`, readFileSync(join(WEB_SRC, rel), 'utf8')] as const);
}

/** Files whose contents match any forbidden import pattern. */
function offenders(
  files: ReadonlyArray<readonly [string, string]>,
  forbidden: RegExp,
): string[] {
  return files.filter(([, src]) => forbidden.test(src)).map(([rel]) => rel);
}

describe('lib/server is server-only', () => {
  /* lib/server holds token crypto, the session key and OAuth secrets. If code
     that runs in the browser imports it, that code — and any secret it closes
     over — can land in a client bundle. Browser code here is components and
     features (generator UI) and, in the web app, everything but its server
     files (lib/server, +server.ts, *.server.ts). The API handlers (api/) run
     on the server and may import it. */
  const CLIENT_DIRS = ['components', 'features'];

  it('is not imported by shared browser code or the web app\'s browser code', () => {
    // Mutation check: point any client file's import at '@/lib/server/...'
    // and this list becomes non-empty.
    expect(offenders(read(CLIENT_DIRS.flatMap(sourceFiles)), /(?:from|import) '@?\/?.*lib\/server\//)).toEqual([]);
    expect(offenders(webBrowserFiles(), /(?:from|import) '[^']*lib\/server\//)).toEqual([]);
  });

  it('guards a non-empty file set (walk did not silently return nothing)', () => {
    expect(CLIENT_DIRS.flatMap(sourceFiles).length).toBeGreaterThan(10);
    expect(webBrowserFiles().length).toBeGreaterThan(50);
  });
});

describe('the OBS overlay does not import generator-only code', () => {
  /* web/src/lib/overlay holds the overlays loaded into an OBS browser source.
     The generator UI (web/src/lib/generator, components/classic) and the
     feature preview simulators exist only to power the generator page and
     must never be pulled into the overlay bundle. */
  it('the overlays import neither generator UI nor preview simulators', () => {
    const files = webBrowserFiles().filter(([rel]) => rel.startsWith('web/src/lib/overlay/'));
    expect(files.length).toBeGreaterThan(5);
    // Mutation check: add `import '#lib/generator/generatorTheme.ts'` to
    // ChatOverlay.svelte and this fails naming that file.
    expect(offenders(files, /(?:from|import) '[^']*(?:generator\/|components\/classic|preview\w*Simulator)/))
      .toEqual([]);
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
