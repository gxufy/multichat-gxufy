import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import CounterPage from '@/pages/counter';
import PoglyViewerCounterPreview from '@/pages/pogly-preview/counter';

const routerState = vi.hoisted(() => ({
  isReady: false,
  query: {} as Record<string, string>,
}));

vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: routerState.isReady,
    query: routerState.query,
    replace: vi.fn(),
  }),
}));

/* Head placement is Next's responsibility and is not part of either mismatch.
   Removing it here keeps the hydration fixture focused on the page body. */
vi.mock('next/head', () => ({
  default: () => null,
}));

function hydrationErrors(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls
    .flat()
    .map((value: unknown) => String(value))
    .filter((message: string) => /hydration|did not match|server html/i.test(message))
    .join('\n');
}

async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
  });
}

afterEach(() => {
  routerState.isReady = false;
  routerState.query = {};
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('/counter hydration', () => {
  it('keeps SSR and the first client render empty, then enables the wrapper after hydration', async () => {
    routerState.isReady = false;
    const serverHtml = renderToString(<CounterPage />);
    expect(serverHtml).toBe('');

    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.appendChild(container);

    routerState.isReady = true;
    const recoverable = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root!: Root;

    await act(async () => {
      root = hydrateRoot(container, <CounterPage />, {
        onRecoverableError: recoverable,
      });
    });

    expect(recoverable).not.toHaveBeenCalled();
    expect(hydrationErrors(consoleError)).toBe('');
    expect(container.querySelector('div')).not.toBeNull();

    await unmount(root);
  });
});

describe('/pogly-preview/counter hydration', () => {
  it('serializes deterministic style text and hydrates it byte-for-byte', async () => {
    const firstHtml = renderToString(<PoglyViewerCounterPreview />);
    const secondHtml = renderToString(<PoglyViewerCounterPreview />);
    const serializedStyle = /<style>([\s\S]*?)<\/style>/.exec(firstHtml)?.[1];

    expect(secondHtml).toBe(firstHtml);
    expect(serializedStyle).toContain("font-family: 'DejaVu Sans'");
    expect(serializedStyle).not.toContain('&#x27;');

    const container = document.createElement('div');
    container.innerHTML = firstHtml;
    document.body.appendChild(container);
    const serverStyleText = container.querySelector('style')?.textContent;

    const recoverable = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root!: Root;

    await act(async () => {
      root = hydrateRoot(container, <PoglyViewerCounterPreview />, {
        onRecoverableError: recoverable,
      });
    });

    expect(recoverable).not.toHaveBeenCalled();
    expect(hydrationErrors(consoleError)).toBe('');
    expect(container.querySelector('style')?.textContent).toBe(serverStyleText);

    await unmount(root);
  });
});
