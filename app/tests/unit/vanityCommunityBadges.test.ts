import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FIXED_PROVIDER_MAX_CONCURRENT_WORK,
  resetFixedProviderResourcesForTests,
  runFixedProviderWork,
} from '@/lib/server/fixedProviderProxy';
import {
  JILCHAT_USER_CACHE_MAX_KEYS,
  loadJilChatBadges,
  parseFfzApSupporters,
  jilChatDirectoryBadges,
  parseJilChatCatalog,
  parseJilChatDirectory,
  parseJilChatOwnership,
  resetVanityCommunityBadgeCachesForTests,
  resolveVanityCommunityBadges,
  vanityCommunityBadgeStatsForTests,
} from '@/lib/server/vanityCommunityBadges';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  resetFixedProviderResourcesForTests();
  resetVanityCommunityBadgeCachesForTests();
  vi.unstubAllGlobals();
});

describe('Vanity community badge parsing', () => {
  it('normalizes FFZ:AP numeric supporter assignments and optional color', () => {
    expect(parseFfzApSupporters([
      { id: '123', badge_color: '#812FA8', badge_is_colored: 1, tier: 3 },
      { id: 456, badge_color: '#ffffff', badge_is_colored: 0, tier: 1 },
      { id: 'not-an-id', badge_color: '#000000', badge_is_colored: 1 },
    ])).toEqual([
      {
        provider: 'ffzap', id: 'supporter', title: 'FFZ:AP Supporter',
        url: 'https://api.ffzap.com/v1/user/badge/123/3', userIds: ['123'],
        backgroundColor: '#812FA8',
      },
      {
        provider: 'ffzap', id: 'supporter', title: 'FFZ:AP Supporter',
        url: 'https://api.ffzap.com/v1/user/badge/456/3', userIds: ['456'],
      },
    ]);
    expect(parseFfzApSupporters({ supporters: [] })).toBeNull();
  });


  it('joins JilChat ownership by slug, dedupes, and skips unsafe art', () => {
    const catalog = parseJilChatCatalog([
      { slug: 'carrot', name: 'JilChat Carrot', image_url: 'https://api.jil.chat/uploads/carrot.png' },
      { slug: 'unsafe', name: 'Unsafe', image_url: 'https://attacker.example/badge.png' },
    ]);
    expect(catalog).not.toBeNull();
    const badges = parseJilChatOwnership([
      { slug: 'carrot', name: 'Wrong Name', image_url: 'https://attacker.example/wrong.png' },
      { slug: 'carrot', name: 'Duplicate', image_url: 'https://api.jil.chat/uploads/duplicate.png' },
      { slug: 'fallback', name: 'JilChat Fallback', image_url: 'https://api.jil.chat/uploads/fallback.png' },
      { slug: 'unsafe', name: 'Unsafe', image_url: 'https://attacker.example/badge.png' },
    ], '123', catalog!);
    expect(badges).toEqual([
      {
        provider: 'jilchat', id: 'carrot', title: 'JilChat Carrot',
        url: 'https://api.jil.chat/uploads/carrot.png', userIds: ['123'],
      },
      {
        provider: 'jilchat', id: 'fallback', title: 'JilChat Fallback',
        url: 'https://api.jil.chat/uploads/fallback.png', userIds: ['123'],
      },
    ]);
  });
});

describe('JilChat bounded server cache', () => {
  it('coalesces concurrent same-user work and reuses the finite-TTL result', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.jil.chat/v1/badges') {
        return jsonResponse([{ slug: 'carrot', name: 'Carrot', image_url: 'https://api.jil.chat/carrot.png' }]);
      }
      if (url === 'https://api.jil.chat/v1/badges/user/123/all') {
        return jsonResponse([{ slug: 'carrot' }, { slug: 'carrot' }]);
      }
      throw new Error('unexpected URL');
    });
    vi.stubGlobal('fetch', fetchMock);

    const [one, two] = await Promise.all([
      loadJilChatBadges('123', 'client-one'),
      loadJilChatBadges('123', 'client-two'),
    ]);
    const three = await loadJilChatBadges('123', 'client-three');

    expect(one).toEqual(two);
    expect(two).toEqual(three);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vanityCommunityBadgeStatsForTests()).toEqual({ jilChatUserCacheKeys: 1 });
  });

  it('keeps at most the configured number of user keys', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.jil.chat/v1/badges') {
        return jsonResponse([{ slug: 'badge', name: 'Badge', image_url: 'https://api.jil.chat/badge.png' }]);
      }
      return jsonResponse([{ slug: 'badge' }]);
    }));

    for (let index = 1; index <= JILCHAT_USER_CACHE_MAX_KEYS + 1; index += 1) {
      await loadJilChatBadges(String(index), `client-${index}`);
    }
    expect(vanityCommunityBadgeStatsForTests().jilChatUserCacheKeys)
      .toBe(JILCHAT_USER_CACHE_MAX_KEYS);
  });

  it('settles every provider branch when fixed-provider capacity is exhausted', async () => {
    const releases: Array<() => void> = [];
    const blockers = Array.from({ length: FIXED_PROVIDER_MAX_CONCURRENT_WORK }, (_, index) =>
      runFixedProviderWork({
        key: `capacity-blocker-${index}`,
        clientKey: 'capacity-test',
        run: () => new Promise<void>((resolve) => releases.push(resolve)),
      }));

    await vi.waitFor(() => expect(releases).toHaveLength(FIXED_PROVIDER_MAX_CONCURRENT_WORK));
    try {
      await expect(resolveVanityCommunityBadges('123', 'capacity-test')).resolves.toEqual([]);
    } finally {
      releases.forEach((release) => release());
      await Promise.all(blockers);
    }
  });
});

describe('JilChat directory (who displays which badge)', () => {
  const list = [
    { slug: 'translator', name: 'JilChat Translator', image_url: 'https://api.jil.chat/t.png', users: [{ twitch_id: '111' }, { twitch_id: 'bad' }, { twitch_id: '222' }] },
    { slug: 'milestone_1', name: 'JilChat Month 1', image_url: 'https://api.jil.chat/m1.png', users: [{ twitch_id: '333' }, { twitch_id: '111' }] },
    { slug: 'evil', name: 'Evil', image_url: 'https://evil.example/x.png', users: [{ twitch_id: '444' }] },
  ];

  it('maps each user to the one badge they display, skipping unsafe art and bad ids', () => {
    const directory = parseJilChatDirectory(list);
    expect(directory?.listsUsers).toBe(true);
    expect([...directory!.displayed]).toEqual([['111', 'translator'], ['222', 'translator'], ['333', 'milestone_1']]);
    expect(jilChatDirectoryBadges(directory!)).toEqual([
      { provider: 'jilchat', id: 'translator', title: 'JilChat Translator', url: 'https://api.jil.chat/t.png', userIds: ['111', '222'] },
      { provider: 'jilchat', id: 'milestone_1', title: 'JilChat Month 1', url: 'https://api.jil.chat/m1.png', userIds: ['333'] },
    ]);
    expect(parseJilChatDirectory([{ slug: 'a', name: 'A', image_url: 'https://api.jil.chat/a.png' }])?.listsUsers).toBe(false);
    expect(parseJilChatDirectory({})).toBeNull();
  });

  it('answers many users from one upstream request, none per user', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === 'https://api.jil.chat/v1/badges') return jsonResponse(list);
      throw new Error(`unexpected ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadJilChatBadges('111', 'a')).toEqual([
      { provider: 'jilchat', id: 'translator', title: 'JilChat Translator', url: 'https://api.jil.chat/t.png', userIds: ['111'] },
    ]);
    expect(await loadJilChatBadges('333', 'b')).toEqual([expect.objectContaining({ id: 'milestone_1', userIds: ['333'] })]);
    for (let id = 1000; id < 1300; id += 1) expect(await loadJilChatBadges(String(id), `c${id}`)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vanityCommunityBadgeStatsForTests()).toEqual({ jilChatUserCacheKeys: 0 });
  });
});
