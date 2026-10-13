export const MULTICHAT_BADGE_PROVIDERS = [
  'platform',
  'uchat',
  'chatterino',
  'homies',
  'moltorino',
  'bluzyrino',
  'ffz',
  'ffzap',
  'bttv',
  'turteg',
  'polandbot',
  'bchat',
  'folhinha',
  'dankchat',
  'chatty',
  'chatsen',
  'purpletv',
  'jilchat',
  '7tv',
] as const;

export type MultichatBadgeProvider = (typeof MULTICHAT_BADGE_PROVIDERS)[number];
export type BadgeLayoutEntry = { provider: MultichatBadgeProvider; visible: boolean };

export const MULTICHAT_BADGE_PROVIDER_LABEL: Record<MultichatBadgeProvider, string> = {
  platform: 'Platform',
  chatterino: 'Chatterino',
  homies: 'Homies',
  moltorino: 'Moltorino',
  bluzyrino: 'Bluzyrino',
  ffz: 'FFZ',
  ffzap: 'FFZ:AP',
  bttv: 'BTTV',
  turteg: 'Turteg',
  '7tv': '7TV',
  uchat: 'UChat',
  bchat: 'bChat',
  polandbot: 'PolandBOT',
  folhinha: 'Folhinha+',
  dankchat: 'DankChat',
  chatty: 'Chatty',
  chatsen: 'Chatsen',
  purpletv: 'PurpleTV',
  jilchat: 'JilChat',
};

const PROVIDER_SET = new Set<string>(MULTICHAT_BADGE_PROVIDERS);

export function parseBadgeLayout(raw: unknown): BadgeLayoutEntry[] {
  const source = typeof raw === 'string' ? raw.trim() : '';
  if (!source) return MULTICHAT_BADGE_PROVIDERS.map((provider) => ({ provider, visible: true }));

  const seen = new Set<MultichatBadgeProvider>();
  const entries: BadgeLayoutEntry[] = [];
  for (const part of source.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const hidden = token.startsWith('!');
    const provider = (hidden ? token.slice(1) : token) as MultichatBadgeProvider;
    if (!PROVIDER_SET.has(provider) || seen.has(provider)) continue;
    seen.add(provider);
    entries.push({ provider, visible: !hidden });
  }

  for (const provider of MULTICHAT_BADGE_PROVIDERS) {
    if (!seen.has(provider)) entries.push({ provider, visible: true });
  }
  return entries;
}

export function serializeBadgeLayout(entries: readonly BadgeLayoutEntry[]): string {
  const normalized = parseBadgeLayout(
    entries.map((entry) => `${entry.visible ? '' : '!'}${entry.provider}`).join(','),
  );
  const encoded = normalized
    .map((entry) => `${entry.visible ? '' : '!'}${entry.provider}`)
    .join(',');
  return encoded === MULTICHAT_BADGE_PROVIDERS.join(',') ? '' : encoded;
}

export function normalizeBadgeLayout(raw: unknown): string {
  return serializeBadgeLayout(parseBadgeLayout(raw));
}

export function badgeProviderFromType(type: string): MultichatBadgeProvider {
  if (!type.startsWith('community:')) return 'platform';
  const provider = type.split(':', 3)[1] ?? '';
  if (provider === 'custom-homies') return 'homies';
  return PROVIDER_SET.has(provider) ? provider as MultichatBadgeProvider : 'platform';
}
