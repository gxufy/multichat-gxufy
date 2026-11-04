/* Homepage links and retired-route forwarding behavior.
 *
 * Canonical hrefs are asserted directly so stale retired routes cannot
 * silently re-enter navigation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import HomePage, { getServerSideProps as getHomePageProps } from '@/pages/index';
import ClassicMultichatPage from '@/pages/classic/multichat';
import RetiredToolPage, { getStaticProps } from '@/pages/tools/[tool]';
import {
  CANONICAL_COUNTER_ROUTE,
  CANONICAL_MULTICHAT_ROUTE,
} from '@/lib/multichatRouting';

const replace = vi.fn();
let query: Record<string, string> = {};

vi.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, query, replace }),
}));

/* next/head renders nothing in jsdom, so its children are asserted by walking
   the element tree the page returns rather than by querying the document. */
vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

/** Set the fragment the retired pages will read on mount. */
const setHash = (hash: string) => {
  window.history.replaceState(null, '', `/${hash}`);
};

beforeEach(() => {
  replace.mockClear();
  query = {};
  setHash('');
});

afterEach(cleanup);

const hrefs = () =>
  Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));

describe('homepage product cards', () => {
  it('uses the supplied GIF as the homepage logo', () => {
    render(<HomePage />);
    expect(document.querySelector('img.hero-avatar')?.getAttribute('src')).toBe('/gxufy-avatar.gif');
  });

  it('links the generator and the counter panel at their canonical addresses', () => {
    render(<HomePage />);
    expect(hrefs()).toContain(CANONICAL_MULTICHAT_ROUTE);
    expect(hrefs()).toContain(CANONICAL_COUNTER_ROUTE);
  });

  /* The /tools pages are redirect stubs now. Linking one would send every new
     visitor through a hop for nothing. */
  it('never links a retired generator path', () => {
    render(<HomePage />);
    for (const href of hrefs()) {
      expect(href).not.toMatch(/^\/tools\//);
      expect(href).not.toBe('/classic/multichat');
    }
  });

  it('gives each card a reachable call to action', () => {
    render(<HomePage />);
    const cards = Array.from(document.querySelectorAll('a.card'));
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.getAttribute('href')).toMatch(/^\/multichat/);
      expect(card.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it('sends the counter card to the panel anchor, not a route of its own', () => {
    render(<HomePage />);
    /* Matched on the heading, not the body copy: the chat card's description
       mentions the viewer counter too, so a whole-card text match finds it. */
    const counterCard = Array.from(document.querySelectorAll('a.card')).find((card) =>
      /counter/i.test(card.querySelector('h2')?.textContent ?? ''),
    );
    expect(counterCard?.getAttribute('href')).toBe(CANONICAL_COUNTER_ROUTE);
    expect(CANONICAL_COUNTER_ROUTE).toContain('#');
  });

  it('points the footer at the canonical generator', () => {
    render(<HomePage />);
    const footer = document.querySelector('footer');
    const link = footer?.querySelector('a[href]');
    expect(link?.getAttribute('href')).toBe(CANONICAL_MULTICHAT_ROUTE);
  });
});

describe('homepage top navigation', () => {
  const EXPECTED_TOP_NAV = ['/multichat'];

  it('keeps only MultiChat in the homepage top nav', () => {
    render(<HomePage />);
    const nav = screen.getByRole('navigation', { name: 'Gxufy pages' });
    expect(Array.from(nav.querySelectorAll('a')).map((link) => link.getAttribute('href')))
      .toEqual(EXPECTED_TOP_NAV);
    expect(nav.textContent).not.toContain('Commands');
    expect(nav.textContent).not.toContain('Supported Services');
    expect(nav.textContent).not.toContain('Contact');
  });

});

describe('homepage support advertisement', () => {
  it('stays absent when support is disabled', () => {
    render(<HomePage />);

    expect(
      document.querySelector(
        'a.support-cta',
      ),
    ).toBeNull();

    expect(
      hrefs(),
    ).not.toContain(
      '/support',
    );
  });

  it('adds a support nav link and promo when enabled', () => {
    render(
      <HomePage supportEnabled />,
    );

    const promo =
      document.querySelector(
        'a.support-cta',
      );

    expect(
      promo?.getAttribute('href'),
    ).toBe('/support');

    expect(
      promo?.textContent,
    ).toContain(
      'Support Gxufy',
    );

    expect(
      promo?.textContent,
    ).toContain(
      'Support for $5',
    );

    expect(
      promo?.querySelector(
        'img',
      )?.getAttribute('src'),
    ).toBe(
      '/badges/gxufy/supporter.webp',
    );

    const nav =
      screen.getByRole(
        'navigation',
        {
          name: 'Gxufy pages',
        },
      );

    expect(
      Array.from(
        nav.querySelectorAll('a'),
      ).map((link) =>
        link.getAttribute('href')),
    ).toEqual([
      '/multichat',
      '/support',
    ]);
  });

  it('uses the exact server-only support flag', async () => {
    const original =
      process.env
        .GXUFY_SUPPORT_PAGE_ENABLED;

    try {
      delete process.env
        .GXUFY_SUPPORT_PAGE_ENABLED;

      const disabled =
        await getHomePageProps(
          {} as never,
        ) as {
          props?: {
            supportEnabled?: boolean;
          };
        };

      expect(
        disabled.props
          ?.supportEnabled,
      ).toBe(false);

      process.env
        .GXUFY_SUPPORT_PAGE_ENABLED =
          '1';

      const enabled =
        await getHomePageProps(
          {} as never,
        ) as {
          props?: {
            supportEnabled?: boolean;
          };
        };

      expect(
        enabled.props
          ?.supportEnabled,
      ).toBe(true);

      process.env
        .GXUFY_SUPPORT_PAGE_ENABLED =
          'true';

      const nonExact =
        await getHomePageProps(
          {} as never,
        ) as {
          props?: {
            supportEnabled?: boolean;
          };
        };

      expect(
        nonExact.props
          ?.supportEnabled,
      ).toBe(false);
    } finally {
      if (original === undefined) {
        delete process.env
          .GXUFY_SUPPORT_PAGE_ENABLED;
      } else {
        process.env
          .GXUFY_SUPPORT_PAGE_ENABLED =
            original;
      }
    }
  });
});

describe('homepage bottom section', () => {
  /* The old bottom was an announcement card promising unnamed future tools, with
     a small Follow button inside it, above a row of three per-network icon
     buttons. All of it is gone except the Follow link itself — whose href is a
     link hub the user maintains and must not be guessed at, so it is asserted by
     exact equality against the value it has always had. */
  const PREVIOUS_FOLLOW_HREF = 'https://guns.lol/gxufy';

  const follow = () => {
    const el = document.querySelector('a.follow-cta');
    expect(el, 'no follow CTA on the page').not.toBeNull();
    return el as HTMLAnchorElement;
  };

  it('no longer promises more tools', () => {
    render(<HomePage />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/more tools are on the way/i);
    expect(text).not.toMatch(/multichat is the first/i);
    expect(text).not.toMatch(/catch what/i);
  });

  it('offers no per-network social buttons', () => {
    render(<HomePage />);
    expect(document.querySelectorAll('a.social')).toHaveLength(0);
    for (const gone of ['x.com', 'twitter', 'github.com', 'discord.com']) {
      for (const href of hrefs()) {
        expect(href?.toLowerCase()).not.toContain(gone);
      }
    }
  });

  it('drops the socials heading with the row it labelled', () => {
    render(<HomePage />);
    expect(document.body.textContent).not.toMatch(/socials/i);
    expect(document.querySelector('.socials-title')).toBeNull();
  });

  it('has exactly one Follow CTA, named for the person not the handle', () => {
    render(<HomePage />);
    expect(document.querySelectorAll('a.follow-cta')).toHaveLength(1);
    expect(follow().textContent?.trim()).toBe('Follow @gxufy');
    // The X handle, which this is no longer specific to.
    expect(document.body.textContent).not.toContain('@Gxufy_');
    expect(document.body.textContent).not.toContain('@gxufy_');
  });

  it('preserves the previous destination exactly', () => {
    render(<HomePage />);
    expect(follow().getAttribute('href')).toBe(PREVIOUS_FOLLOW_HREF);
    expect(follow().getAttribute('rel')).toContain('noreferrer');
    expect(follow().getAttribute('target')).toBe('_blank');
  });

  it('is a prominent standalone CTA, not a button inside a card', () => {
    render(<HomePage />);
    /* Not nested in a card or banner: the requirement is one large CTA, and an
       empty wrapper around it would be exactly what was removed. */
    expect(follow().closest('.card')).toBeNull();
    expect(follow().closest('.banner')).toBeNull();
    expect(document.querySelectorAll('.banner')).toHaveLength(0);
    // Directly in the content column, immediately before the footer.
    expect(follow().parentElement?.className).toBe('wrap');
    expect(follow().nextElementSibling?.tagName).toBe('FOOTER');
  });

  it('styles the CTA large, with hover and keyboard focus states', () => {
    const css = render(<HomePage />).container.innerHTML;
    const rule = css.match(/\.follow-cta \{([^}]*)\}/)![1];
    expect(rule).toContain('display: block');
    expect(rule).toContain('width: 100%');
    // Same accent the cards use, not a new colour.
    expect(rule).toContain('var(--accent)');
    expect(css).toContain('.follow-cta:hover');
    expect(css).toContain('.follow-cta:focus-visible');
  });

  it('keeps the footer underneath it, simple', () => {
    render(<HomePage />);
    const footer = document.querySelector('footer')!;
    expect(footer.textContent).toMatch(/©/);
    expect(footer.querySelectorAll('a')).toHaveLength(1);
  });

  it('mentions no unbuilt product', () => {
    /* MultiAlert is planned and its banner copy is drafted, but it lives in
       TODO.md until the thing exists. Announcing a tool that cannot be opened
       turns the homepage into a promise, which is what the "more tools are on
       the way" card was and why it was removed. */
    render(<HomePage />);
    expect(document.body.textContent).not.toMatch(/multialert/i);
    expect(hrefs().some((href) => /alert/i.test(href ?? ''))).toBe(false);
  });
});

/* The homepage keeps its own overlay forward: a /?kick=name link is an overlay
   request that predates the generator split, and it must still reach the
   overlay. */
describe('homepage overlay forward', () => {
  it.each(['channel', 'kick', 'twitch', 'youtube', 'tiktok'])(
    'forwards ?%s= to the overlay',
    (param) => {
      query = { [param]: 'somechannel' };
      render(<HomePage />);
      expect(replace).toHaveBeenCalled();
      /* Forwarded as a {pathname, query} object so every parameter is carried
         through untouched, rather than a hand-built string. */
      const target = replace.mock.calls[0]?.[0] as {
        pathname: string;
        query: Record<string, string>;
      };
      expect(target.pathname).toBe('/multichat');
      expect(target.pathname).not.toContain('/tools/');
      expect(target.query[param]).toBe('somechannel');
    },
  );

  it('carries every parameter across the forward', () => {
    query = { kick: 'a', twitch: 'b', fade: '30' };
    render(<HomePage />);
    const target = replace.mock.calls[0]?.[0] as {
      pathname: string;
      query: Record<string, string>;
    };
    expect(target.query).toEqual({ kick: 'a', twitch: 'b', fade: '30' });
  });

  it('does not forward a bare visit', () => {
    render(<HomePage />);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('/classic/multichat forwards to the canonical generator', () => {
  it('is excluded from search indexing', () => {
    render(<ClassicMultichatPage />);
    const robots = document.querySelector('meta[name="robots"]');
    expect(robots?.getAttribute('content')).toBe('noindex');
  });

  it('replaces with the canonical generator route', () => {
    render(<ClassicMultichatPage />);
    expect(replace).toHaveBeenCalledWith(CANONICAL_MULTICHAT_ROUTE);
  });

  it('replaces only once, even under a doubled effect run', () => {
    const { unmount } = render(<ClassicMultichatPage />);
    act(() => void 0);
    unmount();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('offers a working link for a visitor whose JavaScript has not run', () => {
    render(<ClassicMultichatPage />);
    expect(
      screen.getByRole('link', { name: 'Continue' }).getAttribute('href'),
    ).toBe(CANONICAL_MULTICHAT_ROUTE);
  });

});

describe('/tools/* forwards to where each tool now lives', () => {
  /** The props the route would build for one id at build time. */
  const props = async (tool: string) =>
    (await getStaticProps({ params: { tool } } as never)) as {
      props?: { destination: string };
      notFound?: true;
    };

  it('sends /tools/multichat to the generator', async () => {
    const built = await props('multichat');
    expect(built.props?.destination).toBe(CANONICAL_MULTICHAT_ROUTE);
    render(<RetiredToolPage destination={built.props!.destination} />);
    expect(replace).toHaveBeenCalledWith(CANONICAL_MULTICHAT_ROUTE);
  });

  it('sends /tools/counter to the counter panel, focused', async () => {
    const built = await props('counter');
    expect(built.props?.destination).toBe(CANONICAL_COUNTER_ROUTE);
    render(<RetiredToolPage destination={built.props!.destination} />);
    expect(replace).toHaveBeenCalledWith(CANONICAL_COUNTER_ROUTE);
    // The counter is a panel anchor, not a route.
    expect(CANONICAL_COUNTER_ROUTE).toBe(`${CANONICAL_MULTICHAT_ROUTE}#viewer-counter`);
  });

  it.each(['unknown', '', 'multichat/../admin'])(
    'refuses to redirect the unregistered id %s',
    async (tool) => {
      expect((await props(tool)).notFound).toBe(true);
    },
  );

  it('does not carry a plain anchor into the destination', () => {
    /* A bare `#faq` is not a connection, and the destination already names the
       section it wants — appending one would produce two fragments. */
    setHash('#faq');
    render(<RetiredToolPage destination={CANONICAL_COUNTER_ROUTE} />);
    expect(replace).toHaveBeenCalledWith(CANONICAL_COUNTER_ROUTE);
  });

  it('is excluded from search indexing', () => {
    render(<RetiredToolPage destination={CANONICAL_MULTICHAT_ROUTE} />);
    expect(
      document.querySelector('meta[name="robots"]')?.getAttribute('content'),
    ).toBe('noindex');
  });

});
