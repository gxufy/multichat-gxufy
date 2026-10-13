/* pages/multichat — one path, two things.
 *
 * The claim that matters most is unchanged and permanent: a URL with a channel
 * renders the overlay and navigates nowhere. Those URLs are in OBS scene
 * collections nobody is going to edit, so no amount of later redesign may capture
 * one. The second claim is new: a channel-less visit renders the generator on this
 * same path rather than forwarding anywhere.
 *
 * The third is the one that is easy to get wrong. The overlay and the generator
 * are separate components, and the generator must not mount for an overlay visit —
 * not even briefly — because mounting it would start a preview iframe inside a
 * live browser source. Equally the overlay must not mount for a generator visit,
 * because that would open IRC connections and a pin poller on a page that is only
 * being used to build a URL.
 *
 * Both are stubbed to markers: this file is about which of the two the route
 * decides to be, not about what either renders.
 */
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
/* vi.mock calls are hoisted above this import, so the page module below is
   evaluated with every mock already registered. */
import MultichatPage from '@/pages/multichat';

const replace = vi.fn();
let query: Record<string, string | string[]> = {};
let isReady = true;

vi.mock('next/router', () => ({
  useRouter: () => ({ isReady, query, replace }),
}));

vi.mock('../../src/components/overlay/ChatOverlay', () => ({
  __esModule: true,
  default: () => <div data-testid="chat-overlay" />,
  FONT_FAMILIES: {},
}));

/* The generator is stubbed for the same reason the overlay is: this file tests
   the branch, and the generator's own behaviour has its own suite. The stub
   records the prop that decides where the page starts. */
vi.mock('../../src/components/classic/ClassicGenerator', () => ({
  __esModule: true,
  default: ({ focusCounter }: { focusCounter?: boolean }) => (
    <div data-testid="classic-generator" data-focus-counter={String(Boolean(focusCounter))} />
  ),
}));

/* Connectors open sockets and timers on start; none of that is under test. Each
   factory builds its own stub inline — these calls are hoisted above every
   top-level binding, so a shared const would not exist yet when they run. */
vi.mock('../../src/lib/connectors/kick', () => ({
  createKickConnector: () => ({ start: () => {}, stop: () => {} }),
}));
vi.mock('../../src/lib/connectors/twitch', () => ({
  createTwitchConnector: () => ({ start: () => {}, stop: () => {} }),
}));
vi.mock('../../src/lib/connectors/youtube', () => ({
  createYouTubeConnector: () => ({ start: () => {}, stop: () => {} }),
}));
vi.mock('../../src/lib/connectors/tiktok', () => ({
  createTikTokConnector: () => ({ start: () => {}, stop: () => {} }),
}));
vi.mock('../../src/lib/cosmetics', () => ({
  createCosmeticsFetcher: () => ({ want: () => {}, stop: () => {} }),
}));

/* The pin poller is counted, not just silenced: a generator visit must never
   start one, and the only way to show that is to observe that it was not called. */
const startPoller = vi.fn(() => () => {});
vi.mock('../../src/lib/twitchPinPoller', () => ({
  startTwitchPinPoller: (...args: unknown[]) => startPoller(...(args as [])),
}));

/** A syntactically valid connection id. Synthetic — never a real one. */
const TEST_ID = '123e4567-e89b-12d3-a456-426614174000';

/* Sets the real fragment on jsdom's location.
 *
 * The page reads `window.location.hash`, not `router.query` — fragments are never
 * sent to the server and never appear in the query. Driving this through the
 * actual location object is the point: a test that only varied `query` could not
 * observe the fragment being ignored, which is exactly how that bug shipped.
 * Assigning `hash` in jsdom updates the URL without navigating. */
function setHash(hash: string): void {
  window.location.hash = hash;
}

beforeEach(() => {
  replace.mockClear();
  startPoller.mockClear();
  query = {};
  isReady = true;
  setHash('');
});

afterEach(() => {
  cleanup();
  setHash('');
});

describe('overlay visits', () => {
  it('renders the overlay for a Kick channel and navigates nowhere', () => {
    query = { kick: 'somechannel' };
    render(<MultichatPage />);
    expect(screen.getByTestId('chat-overlay')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('renders the overlay for the legacy channel alias', () => {
    query = { channel: 'somechannel' };
    render(<MultichatPage />);
    expect(screen.getByTestId('chat-overlay')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(['kick', 'twitch', 'youtube', 'tiktok'] as const)(
    'renders the overlay for a %s channel',
    (param) => {
      query = { [param]: 'somechannel' };
      render(<MultichatPage />);
      expect(screen.getByTestId('chat-overlay')).toBeTruthy();
      expect(replace).not.toHaveBeenCalled();
    },
  );

  /* A scene URL that happens to carry tab=counter is still an overlay URL. */
  it('renders the overlay when a channel and tab=counter are both present', () => {
    query = { twitch: 'somechannel', tab: 'counter' };
    render(<MultichatPage />);
    expect(screen.getByTestId('chat-overlay')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  /* The OBS pin case: the fragment is the overlay's own poll credential, so the
     page serves chat and does not treat the fragment as anything else. */
  it('serves the overlay for a channel carrying a connection fragment', () => {
    query = { twitch: 'somechannel' };
    setHash(`#twitchConnectionId=${TEST_ID}&twitch=someone`);
    render(<MultichatPage />);
    expect(screen.getByTestId('chat-overlay')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('never mounts the generator for an overlay visit', () => {
    query = { kick: 'somechannel' };
    render(<MultichatPage />);
    expect(screen.queryByTestId('classic-generator')).toBeNull();
  });

  it('mounts no generator for an overlay visit under StrictMode either', () => {
    query = { kick: 'somechannel' };
    render(
      <StrictMode>
        <MultichatPage />
      </StrictMode>,
    );
    expect(screen.queryByTestId('classic-generator')).toBeNull();
  });
});

describe('generator visits', () => {
  it('renders the generator for a bare visit', async () => {
    render(<MultichatPage />);
    expect(await screen.findByTestId('classic-generator')).toBeTruthy();
  });

  /* The whole point of the correction: this path no longer forwards anywhere. */
  it('navigates nowhere', () => {
    render(<MultichatPage />);
    expect(replace).not.toHaveBeenCalled();
  });

  it('renders the generator for an empty channel value', async () => {
    query = { kick: '' };
    render(<MultichatPage />);
    expect(await screen.findByTestId('classic-generator')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('never mounts the overlay for a generator visit', () => {
    render(<MultichatPage />);
    expect(screen.queryByTestId('chat-overlay')).toBeNull();
  });

  /* A generator visit must not start Twitch pin polling. The generator builds
     URLs; only a real overlay polls. */
  it('starts no pin poller', () => {
    render(<MultichatPage />);
    expect(startPoller).not.toHaveBeenCalled();
  });

  it('renders one generator under StrictMode double-invocation', async () => {
    render(
      <StrictMode>
        <MultichatPage />
      </StrictMode>,
    );
    expect(await screen.findAllByTestId('classic-generator')).toHaveLength(1);
    expect(replace).not.toHaveBeenCalled();
  });
});

/* Where the generator starts. `/tools/counter` redirects to the counter anchor,
   and old bookmarks carry ?tab=counter — both must land on the counter panel. */
describe('starting at the counter', () => {
  const focusCounter = async () =>
    (await screen.findByTestId('classic-generator')).getAttribute('data-focus-counter');

  it('focuses the counter for the anchor', async () => {
    setHash('#viewer-counter');
    render(<MultichatPage />);
    expect(await focusCounter()).toBe('true');
  });

  it('focuses the counter for the legacy tab query', async () => {
    query = { tab: 'counter' };
    render(<MultichatPage />);
    expect(await focusCounter()).toBe('true');
  });

  it('does not focus the counter for a bare visit', async () => {
    render(<MultichatPage />);
    expect(await focusCounter()).toBe('false');
  });

  /* An OAuth return is not a request to jump to the counter. */
  it('does not focus the counter for a connection fragment', async () => {
    setHash(`#twitchConnectionId=${TEST_ID}&twitch=someone`);
    render(<MultichatPage />);
    expect(await focusCounter()).toBe('false');
  });
});

describe('before the router is ready', () => {
  it('renders neither the overlay nor the generator', () => {
    isReady = false;
    render(<MultichatPage />);
    expect(screen.queryByTestId('chat-overlay')).toBeNull();
    expect(screen.queryByTestId('classic-generator')).toBeNull();
  });

  it('navigates nowhere', () => {
    isReady = false;
    render(<MultichatPage />);
    expect(replace).not.toHaveBeenCalled();
  });
});
