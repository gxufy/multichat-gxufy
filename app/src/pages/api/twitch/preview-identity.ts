import type { NextApiHandler } from 'next';
import {
  PREVIEW_IDENTITY_PROVIDERS,
  type PreviewIdentityProvider,
  type PreviewIdentityProviderMap,
  type PreviewIdentityResponse,
} from '@/features/multichat/previewIdentity';
import {
  loadBTTVPreviewResources,
  loadFFZPreviewResources,
  loadSevenTVPreviewResources,
  loadTwitchPreviewIdentity,
} from '@/lib/previewIdentityProviders';
import {
  FixedProviderAdmissionError,
  fixedProviderClientKey,
  runFixedProviderWork,
} from '@/lib/server/fixedProviderProxy';

const GENERIC_ERROR = { error: 'Unable to load Twitch preview identity.' };
const PREVIEW_IDENTITY_WORK_COST = 8;

function normalizeLogin(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return null;
  const normalized = (value ?? '').trim().replace(/^[@#]/, '').toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(normalized) ? normalized : null;
}

function requestedProviders(value: string | string[] | undefined): PreviewIdentityProvider[] | null {
  if (value === undefined) return [...PREVIEW_IDENTITY_PROVIDERS];
  const values = (Array.isArray(value) ? value : value.split(',')).map((item) => item.trim()).filter(Boolean);
  if (!values.length || values.some((item) => !(PREVIEW_IDENTITY_PROVIDERS as readonly string[]).includes(item))) return null;
  return [...new Set(values)] as PreviewIdentityProvider[];
}

async function loadPreviewIdentity(
  login: string,
  providers: PreviewIdentityProvider[],
): Promise<{ status: 200 | 404; body: PreviewIdentityResponse | { error: string } }> {
  const twitch = await loadTwitchPreviewIdentity(login);
  if (!twitch) return { status: 404, body: { error: 'Twitch user not found.' } };

  const twitchOutcome = twitch.outcome;

  const outcomes = await Promise.all(providers.map(async (provider) => {
    try {
      switch (provider) {
        case 'Twitch':
          return [provider, twitchOutcome] as const;
        case 'FFZ':
          return [provider, await loadFFZPreviewResources(twitch.identity.userId)] as const;
        case 'BTTV':
          return [provider, await loadBTTVPreviewResources(twitch.identity.userId)] as const;
        case '7TV':
          return [provider, await loadSevenTVPreviewResources(twitch.identity.userId)] as const;
      }
    } catch {
      switch (provider) {
        case 'FFZ':
          return [provider, { status: 'failed' as const, resources: { globalEmotes: [], roomEmotes: [], badgeOverrides: {} } }] as const;
        case 'BTTV':
          return [provider, { status: 'failed' as const, resources: { globalEmotes: [], channelEmotes: [], sharedEmotes: [] } }] as const;
        case '7TV':
          return [provider, { status: 'failed' as const, resources: { globalEmotes: [], channelEmotes: [], personalEmotes: [], paint: null, badge: null } }] as const;
        case 'Twitch':
          return [provider, { status: 'failed' as const, resources: { globalBadges: {}, channelBadges: {} } }] as const;
      }
    }
  }));

  const providerMap = Object.fromEntries(outcomes) as Partial<PreviewIdentityProviderMap>;
  const body: PreviewIdentityResponse = {
    identity: twitch.identity,
    providers: providerMap,
  };
  return { status: 200, body };
}

const handler: NextApiHandler = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const login = normalizeLogin(req.query.login);
  const providers = requestedProviders(req.query.providers);
  if (!login || !providers) return res.status(400).json({ error: 'Invalid preview identity request.' });

  try {
    const keyProviders = [...providers].sort().join(',');
    const clientKey = fixedProviderClientKey(req);
    const result = await runFixedProviderWork({
      key: `twitch-preview-identity:${login}:${keyProviders}`,
      clientKey,
      cost: PREVIEW_IDENTITY_WORK_COST,
      run: () => loadPreviewIdentity(login, providers),
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof FixedProviderAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(error.statusCode).json({
        error: error.kind === 'rate'
          ? 'Too many Twitch preview identity requests.'
          : 'Twitch preview identity temporarily unavailable.',
      });
    }
    return res.status(502).json(GENERIC_ERROR);
  }
};

export default handler;
