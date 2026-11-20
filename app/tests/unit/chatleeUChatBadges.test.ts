import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderBadges } from '@/lib/render';
import type { UnifiedMessage } from '@/lib/types';
import {
  __resetCommunityBadgeCache,
  parseChatlee,
  parseUChat,
  resolveTwitchCommunityBadges,
} from '@/lib/communityBadges';

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CHATLEE = {
  provider: { id: 'chatlee', label: 'Chatlee' },
  version: 1,
  badges: [
    {
      badge_type: 'user_custom', id: 'chatlee-galaxy', tooltip: 'Chatlee Galaxy', priority: 260,
      image1: 'https://api.chatlee.lol/api/files/chatlee_badges/g/galaxy.webp?v=g',
      image2: 'https://api.chatlee.lol/api/files/chatlee_badges/g/galaxy.webp?v=g',
      image3: 'https://api.chatlee.lol/api/files/chatlee_badges/g/galaxy.webp?v=g',
      users: ['111', 'not-an-id', '0123'],
    },
    {
      badge_type: 'supporter', id: 'chatlee-top-donor', tooltip: 'Chatlee Top Donor', priority: 180,
      image1: 'https://api.chatlee.lol/a/1.webp', image3: 'https://api.chatlee.lol/a/3.webp',
      users: ['222'],
    },
    { id: 'no-art', tooltip: 'No Art', users: ['333'] },
  ],
};

const UNII = {
  UChat: [
    {
      id: 'dev_uni', type: 'UChat Badge', title: 'UChat Developer uni', users: ['444'],
      imgs: {
        animated: { '1x': 'https://cdn.unii.dev/badges/UChat/dev_uni/animated/1x.webp', '4x': 'https://cdn.unii.dev/badges/UChat/dev_uni/animated/4x.webp' },
        static: { '1x': 'https://cdn.unii.dev/badges/UChat/dev_uni/static/1x.webp', '4x': 'https://cdn.unii.dev/badges/UChat/dev_uni/static/4x.webp' },
      },
    },
    {
      id: 'tester_0', type: 'UChat Badge', title: 'UChat Tester', users: ['555'],
      imgs: { static: { '2x': 'https://cdn.unii.dev/badges/UChat/tester_0/static/2x.webp' } },
    },
    { id: 'broken', title: 'Broken', users: ['666'], imgs: {} },
  ],
  YAUTC: [
    {
      id: 'contributor_0', type: 'YAUTC Badge', title: 'YAUTC Contributor', users: ['555'],
      imgs: { static: { '4x': 'https://cdn.unii.dev/badges/YAUTC/contributor_0/static/4x.webp' } },
    },
  ],
};

describe('Chatlee badge list', () => {
  it('reads it in priority order with only valid Twitch ids', () => {
    const parsed = parseChatlee(CHATLEE);
    expect(parsed.map((badge) => badge.id)).toEqual(['chatlee-top-donor', 'chatlee-galaxy']);
    expect(parsed[0]).toMatchObject({ provider: 'chatlee', title: 'Chatlee Top Donor', url: 'https://api.chatlee.lol/a/3.webp', userIds: ['222'] });
    expect(parsed[1].userIds).toEqual(['111']);
    expect(parseChatlee(null)).toEqual([]);
    expect(parseChatlee({ badges: 'x' })).toEqual([]);
  });
});

describe('UChat and YAUTC badge list', () => {
  it('prefers the animated art and keeps the still one as fallback', () => {
    const parsed = parseUChat(UNII);
    expect(parsed.map((badge) => `${badge.provider}:${badge.id}`)).toEqual(['uchat:dev_uni', 'uchat:tester_0', 'yautc:contributor_0']);
    expect(parsed[0]).toMatchObject({
      url: 'https://cdn.unii.dev/badges/UChat/dev_uni/animated/4x.webp',
      fallbackUrl: 'https://cdn.unii.dev/badges/UChat/dev_uni/static/4x.webp',
      userIds: ['444'],
    });
    expect(parsed[1].url).toBe('https://cdn.unii.dev/badges/UChat/tester_0/static/2x.webp');
    expect(parsed[1].fallbackUrl).toBeUndefined();
    expect(parseUChat([])).toEqual([]);
  });
});

describe('Chatlee, UChat and YAUTC badges in chat', () => {
  beforeEach(() => {
    __resetCommunityBadgeCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function serve(overrides: Record<string, () => Response> = {}) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (overrides[url]) return overrides[url]();
      if (url === 'https://api.chatlee.lol/api/chatlee/badges/chatterino') return jsonResponse(CHATLEE);
      if (url === 'https://unii.molto.lol/badges') return jsonResponse(UNII);
      if (url === 'https://api.chatterino.com/badges') {
        return jsonResponse({ badges: [{ id: 'c', tooltip: 'Chatterino Top Donator', image3: 'https://cdn.example/c.png', users: ['111'] }] });
      }
      return jsonResponse({}, false);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('shows the chatter’s Chatlee badge with its name', async () => {
    serve();
    const badges = await resolveTwitchCommunityBadges({ userId: '111', login: 'someone' });
    expect(badges).toEqual(expect.arrayContaining([
      { type: 'community:chatlee:chatlee-galaxy', title: 'Chatlee Galaxy', url: 'https://api.chatlee.lol/api/files/chatlee_badges/g/galaxy.webp?v=g' },
    ]));
  });

  it('shows UChat and YAUTC badges, animated where there is animated art', async () => {
    serve();
    const dev = await resolveTwitchCommunityBadges({ userId: '444', login: 'uni' });
    expect(dev).toEqual(expect.arrayContaining([{
      type: 'community:uchat:dev-uni',
      title: 'UChat Developer uni',
      url: 'https://cdn.unii.dev/badges/UChat/dev_uni/animated/4x.webp',
      fallbackUrl: 'https://cdn.unii.dev/badges/UChat/dev_uni/static/4x.webp',
    }]));
    const both = await resolveTwitchCommunityBadges({ userId: '555', login: 'tester' });
    expect(both.map((badge) => badge.type)).toEqual(expect.arrayContaining(['community:uchat:tester-0', 'community:yautc:contributor-0']));
  });

  it('keeps every other badge when one of these lists is down', async () => {
    serve({
      'https://api.chatlee.lol/api/chatlee/badges/chatterino': () => jsonResponse({}, false),
      'https://unii.molto.lol/badges': () => { throw new TypeError('network'); },
    });
    const badges = await resolveTwitchCommunityBadges({ userId: '111', login: 'someone' });
    expect(badges.map((badge) => badge.type)).toEqual(['community:chatterino:c']);
  });
});

describe('badge names on hover', () => {
  it('names the source without repeating it', () => {
    const message: UnifiedMessage = {
      platform: 'twitch', id: 'm', senderId: '1', username: 'x', color: '#fff', text: 'hi', emotes: [], timestamp: 1, kind: 'chat',
      badges: [
        { type: 'community:chatlee:chatlee-galaxy', title: 'Chatlee Galaxy', url: 'https://api.chatlee.lol/a.webp' },
        { type: 'community:uchat:tester-0', title: 'UChat Tester', url: 'https://cdn.unii.dev/b.webp' },
        { type: 'community:yautc:contributor-0', title: 'YAUTC Contributor', url: 'https://cdn.unii.dev/c.webp' },
      ],
    };
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null, ...renderBadges(message, [])));
    expect(html).toContain('title="Chatlee Galaxy"');
    expect(html).toContain('title="UChat Tester"');
    expect(html).toContain('title="YAUTC Contributor"');
  });
});
