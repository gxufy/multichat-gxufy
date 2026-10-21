import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  NextApiRequest,
  NextApiResponse,
} from 'next';

import chatsenHandler, {
  CHATSEN_BADGES_URL,
  parseChatsenCatalog,
} from '@/pages/api/twitch/chatsen-badges';

import {
  resetFixedProviderResourcesForTests,
} from '@/lib/server/fixedProviderProxy';

function jsonResponse(
  body: unknown,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      headers: {
        'Content-Type':
          'application/json',
      },
    },
  );
}

function invoke(
  method = 'GET',
): Promise<{
  statusCode: number;
  body: unknown;
}> {
  let statusCode = 200;
  let body: unknown;

  const req = {
    method,
    query: {},
    headers: {},
    socket: {
      remoteAddress:
        '203.0.113.10',
    },
  } as unknown as NextApiRequest;

  const res = {
    setHeader() {},
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  } as unknown as NextApiResponse;

  return Promise.resolve(
    chatsenHandler(req, res),
  ).then(() => ({
    statusCode,
    body,
  }));
}

const fixture = {
  badges: [
    {
      name: 'developer',
      title: 'Chatsen Developer',
      image:
        'https://raw.githubusercontent.com/chatsen/resources/master/assets/nagato.gif',
    },
    {
      name: 'early_bird',
      title: 'Chatsen Early Bird',
      image:
        'https://raw.githubusercontent.com/chatsen/resources/master/assets/old_advice.png',
    },
    {
      name:
        'performance_artist',
      title: 'Chatsen Artist',
      image:
        'https://raw.githubusercontent.com/chatsen/resources/master/assets/CrayonTime.gif',
    },
  ],

  users: [
    {
      id: '693065895',
      name: 'chatsen',
      badges: [
        {
          badgeName:
            'developer',
        },
        {
          badgeName:
            'early_bird',
        },
      ],
    },

    {
      id: '136778668',
      name:
        'feelsdankman_trumpet',
      badges: [
        {
          badgeName:
            'early_bird',
        },
        {
          badgeName:
            'performance_artist',
        },
      ],
    },
  ],
};

afterEach(() => {
  resetFixedProviderResourcesForTests();
  vi.unstubAllGlobals();
});

describe(
  'Chatsen provider parity',
  () => {
    it(
      'reproduces Chatsen ids and immutable Twitch ownership',
      () => {
        expect(
          parseChatsenCatalog(
            fixture,
          ),
        ).toEqual([
          {
            id:
              'chatsen_5e8edd851d2fdfbd7415232c67367cc3',
            title:
              'Chatsen Developer',
            url:
              'https://raw.githubusercontent.com/chatsen/resources/master/assets/nagato.gif',
            users: [
              '693065895',
            ],
            usernames: [
              'chatsen',
            ],
          },
          {
            id:
              'chatsen_ba0ee6c93838feda513230066533e1de',
            title:
              'Chatsen Early Bird',
            url:
              'https://raw.githubusercontent.com/chatsen/resources/master/assets/old_advice.png',
            users: [
              '693065895',
              '136778668',
            ],
            usernames: [
              'chatsen',
              'feelsdankman_trumpet',
            ],
          },
          {
            id:
              'chatsen_e0ebc63d083045c9a5d602857b2d2e96',
            title:
              'Chatsen Artist',
            url:
              'https://raw.githubusercontent.com/chatsen/resources/master/assets/CrayonTime.gif',
            users: [
              '136778668',
            ],
            usernames: [
              'feelsdankman_trumpet',
            ],
          },
        ]);
      },
    );

    it(
      'fetches only the official Chatsen resources catalog',
      async () => {
        const fetchMock =
          vi.fn(
            async (
              input:
                RequestInfo
                | URL,
              init?:
                RequestInit,
            ) => {
              expect(
                String(input),
              ).toBe(
                CHATSEN_BADGES_URL,
              );

              expect(
                init?.redirect,
              ).toBe(
                'error',
              );

              return jsonResponse(
                fixture,
              );
            },
          );

        vi.stubGlobal(
          'fetch',
          fetchMock,
        );

        const result =
          await invoke();

        expect(
          result.statusCode,
        ).toBe(200);

        expect(
          result.body,
        ).toEqual(
          parseChatsenCatalog(
            fixture,
          ),
        );

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      'rejects non-GET methods without upstream work',
      async () => {
        const fetchMock =
          vi.fn();

        vi.stubGlobal(
          'fetch',
          fetchMock,
        );

        const result =
          await invoke(
            'POST',
          );

        expect(
          result.statusCode,
        ).toBe(405);

        expect(
          fetchMock,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
