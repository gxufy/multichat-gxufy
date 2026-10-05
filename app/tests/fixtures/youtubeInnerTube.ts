export const youtubeBootstrap = {
  videoId: 'abcdefghijk',
  apiKey: 'fixture-key',
  clientVersion: '2.20260810.00.00',
  continuation: 'continuation-0',
};

const thumbnail = (url: string, width: number, height = width) => ({ url, width, height });

const emoji = (name: string, id: string) => ({
  emoji: {
    emojiId: id,
    shortcuts: [`:${name}:`],
    isCustomEmoji: true,
    image: {
      thumbnails: [
        thumbnail(`https://yt.example/${name}-16.png`, 16),
        thumbnail(`https://yt.example/${name}-48.png`, 48),
        thumbnail(`javascript:${name}`, 100),
      ],
    },
  },
});

const author = {
  authorName: { runs: [{ text: '@SpeedFan' }] },
  authorExternalChannelId: 'UC-speed-fan',
  authorPhoto: {
    thumbnails: [
      thumbnail('https://yt.example/avatar=s32-c-k-c0x00ffffff-no-rj', 32),
      thumbnail('https://yt.example/avatar=s88-c-k-c0x00ffffff-no-rj', 88),
    ],
  },
  authorBadges: [
    { liveChatAuthorBadgeRenderer: { tooltip: 'Verified', icon: { iconType: 'VERIFIED' } } },
    { liveChatAuthorBadgeRenderer: { tooltip: 'Owner', icon: { iconType: 'OWNER' } } },
    { liveChatAuthorBadgeRenderer: { tooltip: 'Moderator', icon: { iconType: 'MODERATOR' } } },
    {
      liveChatAuthorBadgeRenderer: {
        tooltip: 'Member (24 months)',
        customThumbnail: {
          thumbnails: [
            thumbnail('https://yt.example/member-16.png', 16),
            thumbnail('https://yt.example/member-32.png', 32),
          ],
        },
      },
    },
    { liveChatAuthorBadgeRenderer: { tooltip: 'Unknown experimental role' } },
  ],
};

export const youtubeActions = [
  {
    addChatItemAction: {
      item: {
        liveChatTextMessageRenderer: {
          id: 'yt-normal',
          ...author,
          timestampUsec: '1723300000000000',
          message: {
            runs: [
              { text: 'Hi 😀 before ' },
              emoji('party', 'UC-speed-fan/party'),
              { text: ' middle ' },
              emoji('wave', 'UC-speed-fan/wave'),
              { text: ' after 🎉' },
              { emoji: { emojiId: '❤️', isCustomEmoji: false } },
            ],
          },
        },
      },
    },
  },
  {
    addChatItemAction: {
      item: {
        liveChatTextMessageRenderer: {
          id: 'yt-fallback',
          authorName: { simpleText: 'Plain User' },
          authorExternalChannelId: 'UC-plain',
          message: {
            runs: [
              { text: 'broken ' },
              {
                emoji: {
                  emojiId: 'UC-plain/noart',
                  shortcuts: [':noart:'],
                  isCustomEmoji: true,
                  image: { thumbnails: [{ url: 'data:image/png;base64,bad', width: 100, height: 100 }] },
                },
              },
              { text: ' stays readable' },
            ],
          },
        },
      },
    },
  },
  {
    addChatItemAction: {
      item: {
        liveChatPaidMessageRenderer: {
          id: 'yt-super-chat',
          ...author,
          purchaseAmountText: { simpleText: '$25.00' },
          message: { runs: [{ text: 'Great stream ' }, emoji('party', 'UC-speed-fan/party')] },
        },
      },
    },
  },
  {
    addChatItemAction: {
      item: {
        liveChatPaidStickerRenderer: {
          id: 'yt-super-sticker',
          ...author,
          purchaseAmountText: { simpleText: '$10.00' },
          stickerDisplayText: { simpleText: 'Hype sticker' },
          sticker: { thumbnails: [thumbnail('https://yt.example/sticker-24.png', 24), thumbnail('https://yt.example/sticker-96.png', 96)] },
        },
      },
    },
  },
  {
    addChatItemAction: {
      item: {
        liveChatMembershipItemRenderer: {
          id: 'yt-membership',
          ...author,
          headerSubtext: { runs: [{ text: 'became a member ' }, emoji('wave', 'UC-speed-fan/wave')] },
          message: { runs: [{ text: 'Glad to be here' }] },
        },
      },
    },
  },
  {
    addChatItemAction: {
      item: {
        liveChatSponsorshipsGiftPurchaseAnnouncementRenderer: {
          id: 'yt-gift',
          header: {
            liveChatSponsorshipsHeaderRenderer: {
              ...author,
              primaryText: { runs: [{ text: 'gifted 5 memberships ' }, emoji('party', 'UC-speed-fan/party')] },
            },
          },
        },
      },
    },
  },
  { markChatItemAsDeletedAction: { targetItemId: 'yt-deleted' } },
  { markChatItemsByAuthorAsDeletedAction: { externalChannelId: 'UC-banned' } },
  {
    addBannerToLiveChatCommand: {
      bannerRenderer: {
        liveChatBannerRenderer: {
          contents: {
            liveChatTextMessageRenderer: {
              id: 'yt-pin',
              authorName: { simpleText: '@PinnedUser' },
              authorExternalChannelId: 'UC-pinned',
              message: { runs: [{ text: 'Pinned hello' }] },
            },
          },
        },
      },
    },
  },
  { removeBannerForLiveChatCommand: {} },
];

export const youtubeContinuation = {
  continuationContents: {
    liveChatContinuation: {
      actions: youtubeActions,
      continuations: [
        { timedContinuationData: { continuation: 'continuation-1', timeoutMs: 1000 } },
      ],
    },
  },
};
