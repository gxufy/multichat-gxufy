/* Which 7TV event-stream dispatches should reload what.
 *
 * The channel's stream also carries other people's emote sets: every chatter
 * with personal 7TV emotes shows up as entitlement.create (kind EMOTE_SET) +
 * emote_set.create + emote_set.update for THEIR set. Only an update to the
 * channel's own active set may reload the channel catalog from 7TV; reloading
 * on every chatter's set re-downloaded the whole catalog over and over in busy
 * chats. Likewise only the broadcaster's own user.update can switch the
 * channel's active set.
 */
export type SevenTVDispatchRoute =
  /** The channel's active set changed: reload the catalog from 7TV. */
  | 'channel-set'
  /** Another set changed (a chatter's personal set). */
  | 'personal-set'
  /** The broadcaster's 7TV user changed (it may switch the active set). */
  | 'broadcaster-user'
  /** Cosmetics, entitlements and anything else. */
  | 'other';

export type SevenTVDispatchContext = {
  activeSetId: string | null;
  stvUserId: string | null;
};

function bodyId(data: unknown): string | null {
  const id = (data as { body?: { id?: unknown } })?.body?.id;
  return typeof id === 'string' && id ? id : null;
}

export function routeSevenTVDispatch(data: unknown, context: SevenTVDispatchContext): SevenTVDispatchRoute {
  const type = (data as { type?: unknown })?.type;
  if (typeof type !== 'string') return 'other';
  const id = bodyId(data);

  if (type === 'emote_set.update') {
    /* No id: cannot tell whose set it is, so keep the safe old behaviour. */
    if (!id || id === context.activeSetId) return 'channel-set';
    return 'personal-set';
  }
  if (type === 'emote_set.create' || type === 'emote_set.delete') {
    if (!id) return 'other';
    if (id === context.activeSetId) return type === 'emote_set.delete' ? 'channel-set' : 'other';
    return 'personal-set';
  }
  if (type === 'user.update') {
    if (!id || !context.stvUserId || id === context.stvUserId) return 'broadcaster-user';
    return 'other';
  }
  return 'other';
}
