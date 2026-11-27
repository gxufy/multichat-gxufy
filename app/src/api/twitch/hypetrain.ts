/* GET /api/twitch/hypetrain?channel=<login>
 *
 * The channel's running Hype Train from Twitch's public GQL (no sign-in):
 *   { active: false }
 *   { active: true, level, progress, goal,
 *     endsInMs?, startedAgoMs?,            the level's countdown, how old the train is
 *     kind?, shared?, record?,             what kind of train (regular, golden-kappa,
 *                                          treasure, mythic, community, pinata)
 *     treasure?: { percent, level } }      a treasure train's gift discount
 *
 * Times are relative (milliseconds from now on this server), so a viewer's
 * clock being off never moves the countdown. The extra details are asked for
 * in one richer query; if Twitch refuses it, the plain query (level and
 * progress only) still answers, so the bar keeps working. The kind comes from
 * a second, small query, asked only while a train runs; without it the train
 * shows as a regular one.
 */
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';

import {
  FixedProviderAdmissionError,
  discardFixedProviderBody,
  fixedProviderClientKey,
  readBoundedFixedProviderJson,
  runFixedProviderWork,
  withFixedProviderTimeout,
} from '../../lib/server/fixedProviderProxy';
import type { HypeTrainKind } from '../../lib/types';

const GQL_URL = 'https://gql.twitch.tv/gql';
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

/** Level and progress only: what the bar has always used. */
const QUERY = `
query($login: String) {
  user(login: $login) {
    channel {
      hypeTrain {
        execution {
          isActive
          progress {
            goal
            progression
            level {
              value
            }
          }
        }
      }
    }
  }
}
`;

/** The same, plus the countdown, the start and a treasure train's discount. */
const RICH_QUERY = `
query($login: String) {
  user(login: $login) {
    id
    channel {
      hypeTrain {
        execution {
          isActive
          startedAt
          expiresAt
          isTreasureTrain
          treasureTrainDetails {
            discountPercentage
            discountLevelThreshold
          }
          progress {
            goal
            progression
            level {
              value
            }
          }
        }
      }
    }
  }
}
`;

/** What kind of train a channel runs. */
const KIND_QUERY = `
query($ids: [ID!]!) {
  allActiveHypeTrainStatuses(channelIDs: $ids) {
    hypeTrainType
    isGoldenKappaTrain
    isAllTimeHighTrain
    isTreasureTrain
    isSharedTrain
    channel {
      id
    }
  }
}
`;

export const TWITCH_HYPE_TRAIN_TIMEOUT_MS = 15_000;
export const TWITCH_HYPE_TRAIN_MAX_BYTES = 64 * 1024;

/** A level's countdown is at most a few minutes; anything wilder is ignored. */
const MAX_ENDS_IN_MS = 60 * 60_000;
const MAX_STARTED_AGO_MS = 48 * 60 * 60_000;

const GENERIC_ERROR = { error: 'Unable to load Twitch Hype Train status.' };

const KINDS: Readonly<Record<string, HypeTrainKind>> = {
  REGULAR: 'regular',
  GOLDEN_KAPPA: 'golden-kappa',
  TREASURE: 'treasure',
  MYTHIC: 'mythic',
  COMMUNITY: 'community',
  PINATA: 'pinata',
};

type ActiveResponse = {
  active: true;
  level: number;
  progress: number;
  goal: number;
  endsInMs?: number;
  startedAgoMs?: number;
  kind?: HypeTrainKind;
  shared?: boolean;
  record?: boolean;
  treasure?: { percent: number; level: number };
};

type InactiveResponse = { active: false };

type Parsed = { train: ActiveResponse | InactiveResponse; userId: string | null };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) return null;
  return value;
}

/** Milliseconds since the epoch for an ISO time, or null. */
function isoTime(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/** The train from a plain or rich answer; null when the answer is not what Twitch sends. */
function parseHypeTrain(body: unknown, now: number): Parsed | null {
  if (
    !isPlainObject(body)
    || !isPlainObject(body.data)
    || !isPlainObject(body.data.user)
    || !isPlainObject(body.data.user.channel)
    || !('hypeTrain' in body.data.user.channel)
  ) {
    return null;
  }
  const user = body.data.user;
  const userId = typeof user.id === 'string' && /^\d{1,20}$/.test(user.id) ? user.id : null;
  const hypeTrain = (user.channel as Record<string, unknown>).hypeTrain;
  if (hypeTrain === null) return { train: { active: false }, userId };
  if (!isPlainObject(hypeTrain)) return null;
  const execution = hypeTrain.execution;
  if (execution === null || execution === undefined) return { train: { active: false }, userId };
  if (!isPlainObject(execution) || typeof execution.isActive !== 'boolean') return null;
  if (!execution.isActive) return { train: { active: false }, userId };
  if (!isPlainObject(execution.progress)) return null;
  const progressData = execution.progress;
  if (!isPlainObject(progressData.level)) return null;
  const level = safeInteger(progressData.level.value, 1);
  const progress = safeInteger(progressData.progression, 0);
  const goal = safeInteger(progressData.goal, 0);
  if (level === null || progress === null || goal === null) return null;

  const train: ActiveResponse = { active: true, level, progress, goal };
  const endsAt = isoTime(execution.expiresAt);
  if (endsAt !== null) train.endsInMs = Math.min(MAX_ENDS_IN_MS, Math.max(0, endsAt - now));
  const startedAt = isoTime(execution.startedAt);
  if (startedAt !== null) train.startedAgoMs = Math.min(MAX_STARTED_AGO_MS, Math.max(0, now - startedAt));
  if (execution.isTreasureTrain === true) {
    train.kind = 'treasure';
    const details = execution.treasureTrainDetails;
    if (isPlainObject(details)) {
      const percent = safeInteger(details.discountPercentage, 1, 100);
      const atLevel = safeInteger(details.discountLevelThreshold, 1, 1000);
      if (percent !== null && atLevel !== null) train.treasure = { percent, level: atLevel };
    }
  }
  return { train, userId };
}

/** The kind, shared and all-time-high flags for `userId`'s train, or null. */
function parseKind(body: unknown, userId: string): Pick<ActiveResponse, 'kind' | 'shared' | 'record'> | null {
  if (!isPlainObject(body) || !isPlainObject(body.data) || !Array.isArray(body.data.allActiveHypeTrainStatuses)) {
    return null;
  }
  const statuses = body.data.allActiveHypeTrainStatuses.filter(isPlainObject);
  const status = statuses.find((item) => isPlainObject(item.channel) && item.channel.id === userId);
  if (!status) return null;
  const named = typeof status.hypeTrainType === 'string' ? KINDS[status.hypeTrainType] : undefined;
  const kind: HypeTrainKind = named && named !== 'regular'
    ? named
    : status.isGoldenKappaTrain === true
      ? 'golden-kappa'
      : status.isTreasureTrain === true
        ? 'treasure'
        : named ?? 'regular';
  return { kind, shared: status.isSharedTrain === true, record: status.isAllTimeHighTrain === true };
}

async function postGql(query: string, variables: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(GQL_URL, {
    method: 'POST',
    headers: { 'Client-ID': GQL_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    redirect: 'error',
    signal,
  });
  if (!response.ok) {
    await discardFixedProviderBody(response);
    throw new Error('Twitch Hype Train lookup failed.');
  }
  return readBoundedFixedProviderJson(response, TWITCH_HYPE_TRAIN_MAX_BYTES);
}

const refused = (body: unknown) => isPlainObject(body) && Array.isArray(body.errors) && body.errors.length > 0;

/** Rich query first; the plain one if Twitch refuses it; then the kind while a train runs. */
async function lookUp(channel: string, signal: AbortSignal): Promise<ActiveResponse | InactiveResponse | null> {
  const rich = await postGql(RICH_QUERY, { login: channel }, signal);
  let parsed = refused(rich) ? null : parseHypeTrain(rich, Date.now());
  if (!parsed) {
    const plain = await postGql(QUERY, { login: channel }, signal);
    parsed = parseHypeTrain(plain, Date.now());
    return parsed?.train ?? null;
  }
  const { train, userId } = parsed;
  if (train.active && userId) {
    try {
      const kindBody = await postGql(KIND_QUERY, { ids: [userId] }, signal);
      const kind = refused(kindBody) ? null : parseKind(kindBody, userId);
      if (kind) {
        /* A treasure train told by its execution stays one. */
        if (kind.kind !== 'regular' || !train.kind) train.kind = kind.kind;
        if (kind.shared) train.shared = true;
        if (kind.record) train.record = true;
      }
    } catch (error) {
      if (signal.aborted) throw error;
      /* Without the kind the train shows as a regular one. */
    }
  }
  return train;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  if (Array.isArray(req.query.channel)) {
    res.status(400).json({ error: 'Invalid channel.' });
    return;
  }
  const channel = (req.query.channel ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9_]{1,25}$/.test(channel)) {
    res.status(400).json({ error: 'Invalid channel.' });
    return;
  }

  try {
    const train = await runFixedProviderWork({
      key: `twitch-hypetrain:${channel}`,
      clientKey: fixedProviderClientKey(req),
      run: () => withFixedProviderTimeout(TWITCH_HYPE_TRAIN_TIMEOUT_MS, (signal) => lookUp(channel, signal)),
    });
    if (!train) {
      res.status(502).json(GENERIC_ERROR);
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(train);
  } catch (error) {
    if (error instanceof FixedProviderAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      res.status(error.statusCode).json({
        error: error.kind === 'rate'
          ? 'Too many Twitch Hype Train requests.'
          : 'Twitch Hype Train status temporarily unavailable.',
      });
      return;
    }
    res.status(502).json(GENERIC_ERROR);
  }
}
