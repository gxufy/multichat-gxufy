import { describe, expect, it } from 'vitest';
import { buildSevenTVEventUrl } from '@/lib/sevenTVEventUrl';

describe('7TV EventAPI active-set subscriptions', () => {
  it('watches both the current emote set and the 7TV user so active-set switches can resync', () => {
    expect(
      buildSevenTVEventUrl(
        'twitch',
        '641972806',
        'stv-user-id',
        'active-set-id',
      ),
    ).toBe(
      'https://events.7tv.io/v3@'
      + 'entitlement.*<ctx=channel;platform=TWITCH;id=641972806>,'
      + 'cosmetic.*<ctx=channel;platform=TWITCH;id=641972806>,'
      + 'user.update<object_id=stv-user-id>,'
      + 'emote_set.*<object_id=active-set-id>',
    );
  });

  it('omits unavailable user/set subscriptions without inventing ids', () => {
    expect(
      buildSevenTVEventUrl(
        'kick',
        '123',
        null,
        null,
      ),
    ).toBe(
      'https://events.7tv.io/v3@'
      + 'entitlement.*<ctx=channel;platform=KICK;id=123>,'
      + 'cosmetic.*<ctx=channel;platform=KICK;id=123>',
    );
  });
});
