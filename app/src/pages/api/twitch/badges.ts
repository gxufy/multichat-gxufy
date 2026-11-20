
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  FixedProviderAdmissionError,
  discardFixedProviderBody,
  fixedProviderClientKey,
  readBoundedFixedProviderJson,
  runFixedProviderWork,
  withFixedProviderTimeout,
} from '../../../lib/server/fixedProviderProxy';

const GQL_URL = 'https://gql.twitch.tv/gql';
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GENERIC_ERROR = { error: 'Unable to load Twitch badges.' };
export const TWITCH_BADGES_TIMEOUT_MS = 5_000;
export const TWITCH_BADGES_MAX_BYTES = 512 * 1024;

type BadgeNode = { setID: string; version: string; imageURL: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function httpsImage(value: unknown): value is string {
  if (!nonEmptyString(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function badgeNodes(value: unknown): BadgeNode[] | null {
  if (!Array.isArray(value)) return null;
  const nodes: BadgeNode[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    if (!nonEmptyString(item.setID) || !nonEmptyString(item.version) || !httpsImage(item.imageURL)) continue;
    if (item.setID.includes('/') || item.version.includes('/')) continue;
    nodes.push({ setID: item.setID, version: item.version, imageURL: item.imageURL });
  }
  return nodes;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (Array.isArray(req.query.channel) || Array.isArray(req.query.preview)) {
    return res.status(400).json({ error: 'Invalid channel.' });
  }
  const rawChannel = req.query.channel;
  const channel = (rawChannel ?? '').trim().toLowerCase();
  if (channel && !/^[a-z0-9_]{1,25}$/.test(channel)) {
    return res.status(400).json({ error: 'Invalid channel.' });
  }

  try {
    const body = await runFixedProviderWork({
      key: `twitch-badges:${channel || '*'}`,
      clientKey: fixedProviderClientKey(req),
      run: () => withFixedProviderTimeout(TWITCH_BADGES_TIMEOUT_MS, async (signal) => {
        const response = await fetch(GQL_URL, {
          method: 'POST',
          headers: { 'Client-ID': GQL_CLIENT_ID, 'Content-Type': 'application/json' },
          body: JSON.stringify(channel
            ? {
                query: `query($login: String!) {
                  badges { setID version imageURL(size: DOUBLE) }
                  user(login: $login) {
                    id
                    broadcastBadges { setID version imageURL(size: DOUBLE) }
                  }
                }`,
                variables: { login: channel },
              }
            : {
                query: `query {
                  badges { setID version imageURL(size: DOUBLE) }
                }`,
              }),
          redirect: 'error',
          signal,
        });
        if (!response.ok) {
          await discardFixedProviderBody(response);
          throw new Error('Twitch badge lookup failed');
        }
        return readBoundedFixedProviderJson(response, TWITCH_BADGES_MAX_BYTES);
      }),
    });
    if (!isPlainObject(body) || !isPlainObject(body.data)) {
      return res.status(502).json(GENERIC_ERROR);
    }
    const global = badgeNodes(body.data.badges);
    const user = body.data.user;
    const channelNodes = !channel || user === null
      ? []
      : isPlainObject(user)
        ? badgeNodes(user.broadcastBadges)
        : null;
    if (global === null || channelNodes === null) {
      return res.status(502).json(GENERIC_ERROR);
    }

    const map: Record<string, string> = {};
    for (const badge of global) map[`${badge.setID}/${badge.version}`] = badge.imageURL;
    for (const badge of channelNodes) map[`${badge.setID}/${badge.version}`] = badge.imageURL;

    res.setHeader('Cache-Control', 'public, max-age=3600');
    const preview = req.query.preview === '1';
    return res.status(200).json(preview
      ? {
          badges: map,
          roomId: channel && isPlainObject(user) && nonEmptyString(user.id) ? user.id : null,
        }
      : map);
  } catch (error) {
    if (error instanceof FixedProviderAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(error.statusCode).json({
        error: error.kind === 'rate'
          ? 'Too many Twitch badge requests.'
          : 'Twitch badges temporarily unavailable.',
      });
    }
    return res.status(502).json(GENERIC_ERROR);
  }
}
