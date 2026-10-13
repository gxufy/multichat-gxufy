from pathlib import Path
import re

root = Path('.')
generator_path = root / 'app/src/components/classic/ClassicGenerator.tsx'
hook_path = root / 'app/src/components/classic/useCounterPreviewSimulator.ts'
controls_path = root / 'app/src/components/classic/ClassicCounterFeedControls.tsx'
styles_path = root / 'app/src/components/classic/classicStyles.ts'
test_path = root / 'app/tests/unit/counterSimulator.test.tsx'
script_path = root / '.github/scripts/finalize-counter-cleanup.py'

def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing expected source block: {label}')
    return text.replace(old, new, 1)

# Generator: remove every user/manual simulation control path. Preview Data keeps
# only the autonomous hook plus deterministic sample fallback before its first tick.
g = generator_path.read_text()
g = replace_once(g, "import ClassicCounterFeedControls from './ClassicCounterFeedControls';\n", '', 'counter controls import')
g = replace_once(g, "import { combinationLabel } from '@/features/counter/previewSimulator';\n", '', 'combination label import')
g = replace_once(
    g,
    "import {\n  SAMPLE_COUNTER_COUNTS,\n  parseCounterCount,\n  sampleCounterStatuses,\n} from '@/features/counter/samples';\n",
    "import { sampleCounterStatuses } from '@/features/counter/samples';\n",
    'counter sample imports',
)
g = replace_once(g, "import { PLATFORM_ORDER } from '@/lib/viewerCounterConfig';\n", '', 'platform order import')

g, count = re.subn(
    r"/\* The built-in counts as field strings, for the editable preview inputs\..*?\n}\n\n",
    '',
    g,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit('failed to remove sample count field helper')

g, count = re.subn(
    r"/\* Counter platform labels, taken from the descriptor's own channel fields rather.*?\n\) as Record<ViewerPlatform, string>;\n\n",
    '',
    g,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit('failed to remove counter platform label map')

start = g.find('  /* The live Counter rotation. Generator-only in the same way the chat feed is:')
end = g.find('  /* Rendered origin.', start)
if start < 0 or end < 0:
    raise SystemExit('failed to locate Viewer Counter simulator state block')
g = g[:start] + """  /* Viewer Counter Preview Data is autonomous, like the Chat Preview feed.
     It never enters a generated URL, draft, network request, or provider poll.
     Before its first timed change the production renderer receives the fixed
     sample statuses, preserving identical server/client first paint. */
  const counterSim = useCounterPreviewSimulator();
  const counterStatuses = counterSim.statuses ?? sampleCounterStatuses();

""" + g[end:]

g, count = re.subn(
    r"\n        \{/\* Paired with the fixture preview, because this is what feeds it\..*?\n        \)\}\n\n(?=        <p className=\"card-note\">)",
    '\n',
    g,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit('failed to remove Viewer Counter controls render block')
generator_path.write_text(g)

# Production hook: there is no user-switchable state anymore. It simply cycles,
# pauses invisibly when the page is hidden, and resumes when visible again.
hook_path.write_text('''/* The autonomous Viewer Counter Preview Data rotation.
 *
 * ClassicCounterPreview stays pure: this hook owns the timer and hands finished
 * PlatformStatuses to the production renderer. It starts with null so the
 * generator can server-render deterministic sample data, then continuously
 * cycles every platform combination while the tab is visible.
 *
 * Browser-safe: no network, no /api/viewers, no polling, no sockets.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COUNTER_COMBINATIONS,
  nextCounterDelay,
  shuffledCombinations,
  statusesForCombination,
  type CounterCombination,
} from '@/features/counter/previewSimulator';
import type { PreviewSpeed, RandomSource } from '@/lib/tools/previewRandom';
import type { PlatformStatuses } from '@/lib/viewerCounterConfig';

export type CounterSimulatorOptions = {
  /** Deterministic source for tests; production defaults to Math.random. */
  random?: RandomSource;
  /** Fixed cadence for tests. Production uses Normal. */
  speed?: PreviewSpeed;
};

export type CounterSimulatorState = {
  readonly statuses: PlatformStatuses | null;
  readonly combination: CounterCombination | null;
  readonly seenCount: number;
  readonly running: boolean;
  readonly speed: PreviewSpeed;
};

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function useCounterPreviewSimulator(
  options: CounterSimulatorOptions = {},
): CounterSimulatorState {
  const speed = options.speed ?? 'normal';
  const random = useMemo<RandomSource>(
    () => options.random ?? (() => Math.random()),
    [options.random],
  );

  const [statuses, setStatuses] = useState<PlatformStatuses | null>(null);
  const [combination, setCombination] = useState<CounterCombination | null>(null);
  const [seen, setSeen] = useState<ReadonlySet<CounterCombination>>(() => new Set());
  const [hidden, setHidden] = useState(false);
  const bagRef = useRef<CounterCombination[] | null>(null);
  const lastRef = useRef<CounterCombination | null>(null);

  const step = useCallback(() => {
    if (bagRef.current === null || bagRef.current.length === 0) {
      bagRef.current = shuffledCombinations(random, lastRef.current ?? undefined);
    }
    const next = bagRef.current.shift()!;
    lastRef.current = next;
    setCombination(next);
    setStatuses(statusesForCombination(next, random));
    setSeen((current) => {
      if (current.has(next)) return current;
      const grown = new Set(current);
      grown.add(next);
      return grown;
    });
  }, [random]);

  useEffect(() => {
    const sync = () => setHidden(documentHidden());
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const running = !hidden;

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      if (cancelled) return;
      step();
      timer = setTimeout(tick, nextCounterDelay(random, speed));
    };

    timer = setTimeout(tick, nextCounterDelay(random, speed));
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [running, speed, random, step]);

  return {
    statuses,
    combination,
    seenCount: seen.size,
    running,
    speed,
  };
}

export const COUNTER_STATE_COUNT = COUNTER_COMBINATIONS.length;
''')

# Delete CSS that could only style the retired simulation/manual-control panel.
styles = styles_path.read_text()
styles, count = re.subn(
    r"/\* Counter simulation controls, inside the Counter output card\..*?(?=/\* URL result\.)",
    '',
    styles,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit('failed to remove retired Viewer Counter control CSS')
styles_path.write_text(styles)

# Keep the pure simulator tests above the hook marker. Replace only the old
# interaction/control tests with autonomous-hook and generator behavior coverage.
t = test_path.read_text()
t = replace_once(
    t,
    "import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';\n",
    "import { act, cleanup, render } from '@testing-library/react';\n",
    'testing-library import',
)
t = replace_once(t, "import { counterTool } from '@/features/counter/config';\n", '', 'counter tool test import')
t = replace_once(t, "import { SAMPLE_COUNTER_COUNTS } from '@/features/counter/samples';\n", '', 'sample count test import')

marker = "/* ------------------------------------------------------------------ */\n/* The hook                                                           */"
index = t.find(marker)
if index < 0:
    raise SystemExit('failed to locate hook test marker')

new_tail = '''/* ------------------------------------------------------------------ */
/* The autonomous hook                                                */
/* ------------------------------------------------------------------ */

describe('the autonomous counter rotation hook', () => {
  it('starts running with deterministic fixture fallback still requested', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    expect(view.state.running).toBe(true);
    expect(view.state.speed).toBe('normal');
    expect(view.state.statuses).toBeNull();
    expect(view.state.combination).toBeNull();
    expect(view.state.seenCount).toBe(0);
  });

  it('produces its first state on the first timed change, not during render', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    act(() => void vi.advanceTimersByTime(counterDelayBounds('normal').min - 1));
    expect(view.state.statuses).toBeNull();
    advance(1);
    expect(view.state.statuses).not.toBeNull();
    expect(view.state.combination).not.toBeNull();
    expect(view.state.seenCount).toBe(1);
  });

  it('cycles all sixteen states automatically in one bag', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    const seen = new Set<CounterCombination>();
    for (let i = 0; i < COUNTER_STATE_COUNT; i += 1) {
      advance(1);
      seen.add(view.state.combination!);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([...COUNTER_COMBINATIONS]);
    expect(view.state.seenCount).toBe(COUNTER_STATE_COUNT);
  });

  it('keeps reshuffling instead of stopping after one pass', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    advance(COUNTER_STATE_COUNT * 2);
    expect(view.state.combination).not.toBeNull();
    expect(view.state.seenCount).toBe(COUNTER_STATE_COUNT);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('accepts a fixed test cadence without exposing a runtime speed control', () => {
    const view = mountSimulator({ random: seededRandom(2), speed: 'fast' });
    expect(view.state.speed).toBe('fast');
    act(() => void vi.advanceTimersByTime(counterDelayBounds('fast').min - 1));
    expect(view.state.statuses).toBeNull();
    advance(1);
    expect(view.state.statuses).not.toBeNull();
  });

  it('pauses automatically while hidden and resumes when visible', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    advance(1);
    const held = view.state.combination;
    setVisibility('hidden');
    expect(view.state.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(view.state.combination).toBe(held);
    setVisibility('visible');
    expect(view.state.running).toBe(true);
    advance(1);
    expect(view.state.combination).not.toBe(held);
  });

  it('arms one scheduler under Strict Mode and cleans it up on unmount', () => {
    function Probe() {
      useCounterPreviewSimulator({ random: seededRandom(2) });
      return null;
    }
    const view = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('opens no network channel and mutates no URL or storage', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const socket = vi.fn();
    vi.stubGlobal('WebSocket', socket);
    vi.stubGlobal('EventSource', socket);
    const href = window.location.href;
    window.sessionStorage.clear();
    const view = mountSimulator({ random: seededRandom(2) });
    advance(20);
    expect(view.state.seenCount).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
    expect(window.location.href).toBe(href);
    expect(window.sessionStorage.length).toBe(0);
    vi.unstubAllGlobals();
  });
});

/* ------------------------------------------------------------------ */
/* Inside the generator                                               */
/* ------------------------------------------------------------------ */

describe('the autonomous rotation inside the generator', () => {
  const frame = () =>
    document.querySelector<HTMLIFrameElement>(
      'iframe[title="Viewer Counter sample preview"]',
    )!;

  const preview = () => frame().contentDocument!.body;

  const pillCount = () => {
    const row = (preview().firstElementChild as HTMLElement | null)?.querySelector('div');
    return row ? row.children.length : 0;
  };

  it('exposes no simulation or manual-override controls', () => {
    render(<ClassicGenerator />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Live counter simulation/i);
    expect(text).not.toMatch(/Pause simulation/i);
    expect(text).not.toMatch(/Next combination/i);
    expect(text).not.toMatch(/Restore simulation/i);
    expect(text).not.toMatch(/Simulation speed/i);
    expect(text).not.toMatch(/Manual preview values/i);
    expect(document.querySelector('.preview-counter-feed')).toBeNull();
    expect(document.querySelector('.preview-manual')).toBeNull();
    for (const platform of PLATFORM_ORDER) {
      expect(document.getElementById(`sample-count-${platform}`)).toBeNull();
    }
  });

  it('shows deterministic sample data before the first automatic change', () => {
    render(<ClassicGenerator />);
    expect(pillCount()).toBe(1);
  });

  it('keeps the generated counter URL free of simulated counts', () => {
    render(<ClassicGenerator />);
    const url = document.querySelectorAll('.url-code')[1]?.textContent ?? '';
    const query = url.split('?')[1] ?? '';
    expect(query).not.toMatch(/viewers|combination|sim-/i);
    expect(query).not.toMatch(/\d{4,}/);
  });

  it('does not poll viewer APIs while only Preview Data is showing', () => {
    const fetchSpy = vi.fn((_input: RequestInfo | URL) =>
      Promise.reject(new Error('no network in this test')),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const socket = vi.fn();
    vi.stubGlobal('WebSocket', socket);
    vi.stubGlobal('EventSource', socket);
    render(<ClassicGenerator />);
    act(() => void vi.advanceTimersByTime(30_000));
    expect(fetchSpy.mock.calls.every(([url]) => !String(url).includes('/api/viewers'))).toBe(true);
    expect(socket).not.toHaveBeenCalled();
    expect(frame().getAttribute('src')).toBeNull();
    expect(frame().getAttribute('srcdoc')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('changes the rendered preview automatically without button presses', () => {
    render(<ClassicGenerator />);
    const sizes = new Set<number>([pillCount()]);
    for (let i = 0; i < 480; i += 1) {
      act(() => void vi.advanceTimersByTime(250));
      sizes.add(pillCount());
    }
    expect(sizes.size).toBeGreaterThan(1);
  });
});
'''
test_path.write_text(t[:index] + new_tail)

if not controls_path.exists():
    raise SystemExit('retired controls component already missing unexpectedly')
controls_path.unlink()

# Guard against accidentally leaving a production route back into the retired UI.
source = generator_path.read_text()
for value in [
    'ClassicCounterFeedControls',
    'setCounterMode',
    'sampleCounts',
    'Manual preview values',
    'Next combination',
]:
    if value in source:
        raise SystemExit(f'retired Viewer Counter source remains: {value}')

# The transport script is temporary; its successful commit removes it.
script_path.unlink()
