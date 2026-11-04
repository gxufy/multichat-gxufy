import { describe, expect, it } from 'vitest';
import {
  buildMessageFilter,
  type MessageFilterConfig,
} from '@/lib/multichatMessageModel';
import type { UnifiedMessage } from '@/lib/types';

const BASE_CONFIG: MessageFilterConfig = {
  botNames: '',
  permittedBots: '',
  userBL: '',
  prefixBL: '',
  showSystemMsgs: true,
  showFirstMessages: true,
  showRedeems: true,
};

function message(
  login: string,
  displayName = login,
): UnifiedMessage {
  return {
    platform: 'twitch',
    id: `message-${login}`,
    senderId: `id-${login}`,
    senderUsername: login,
    senderDisplayName: displayName,
    username: displayName,
    color: '#ffffff',
    badges: [],
    text: 'hello',
    emotes: [],
    timestamp: 1,
    kind: 'chat',
  };
}

describe('built-in bot filtering and explicit permits', () => {
  it.each(['moobot', 'Moobot', 'nightbot'])(
    'hides the built-in bot %s by default',
    (login) => {
      expect(buildMessageFilter(BASE_CONFIG)(message(login))).toBe(false);
    },
  );

  it.each([
    ['moobot', 'MOOBOT'],
    ['nightbot', 'NightBot'],
  ])('permits %s case-insensitively', (login, permittedBots) => {
    const filter = buildMessageFilter({ ...BASE_CONFIG, permittedBots });
    expect(filter(message(login))).toBe(true);
  });

  it('keeps the explicit user blacklist authoritative over a permit', () => {
    const filter = buildMessageFilter({
      ...BASE_CONFIG,
      permittedBots: 'nightbot',
      userBL: 'nightbot',
    });
    expect(filter(message('NightBot'))).toBe(false);
  });

  it('retains legacy botNames as an extra-hide list', () => {
    const filter = buildMessageFilter({ ...BASE_CONFIG, botNames: 'LegacyBot' });
    expect(filter(message('legacybot'))).toBe(false);
    expect(filter(message('ordinaryviewer'))).toBe(true);
  });

  it('lets an explicit permit bypass the legacy extra-hide list', () => {
    const filter = buildMessageFilter({
      ...BASE_CONFIG,
      botNames: 'LegacyBot',
      permittedBots: 'legacybot',
    });
    expect(filter(message('LegacyBot'))).toBe(true);
  });

  it('leaves normal filtering unchanged when permittedBots is blank', () => {
    const filter = buildMessageFilter({ ...BASE_CONFIG, permittedBots: '   ' });
    expect(filter(message('ordinaryviewer'))).toBe(true);
    expect(filter(message('StreamElements'))).toBe(false);
  });

  it('checks canonical login and display-name without concatenating identities', () => {
    const permitted = buildMessageFilter({ ...BASE_CONFIG, permittedBots: 'nightbot' });
    expect(permitted(message('nightbot', 'Localized Bot'))).toBe(true);

    const blacklisted = buildMessageFilter({ ...BASE_CONFIG, userBL: 'localizedbot' });
    expect(blacklisted(message('safe-login', 'LocalizedBot'))).toBe(false);
  });
});
