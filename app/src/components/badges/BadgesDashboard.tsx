/*
 * /badges: sign in with Twitch, see your FlossChat badge, wear it or take it
 * off. Saves on click (no Save button) and the preview updates at once; live
 * overlays follow within about 15 seconds.
 *
 * Look and motion follow the site's shared motion system (components/site/
 * motion.ts): quick 150 ms transitions, springy presses, cards that rise in,
 * a status pill that pops in. All motion is off under prefers-reduced-motion.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  buildSupportBadgePreview,
  buildSupportUsernameStyle,
} from '@/components/support/SupportCheckout';
import { MOTION_BASE_CSS } from '@/components/site/motion';
import {
  OWNER_COMMAND_MAX_LENGTH,
  OWNER_RUNNABLE_COMMANDS,
  ownerCommandArguments,
  ownerCommandTakesArguments,
} from '@/lib/overlayOwnerCommands';
import type { MultichatCommand } from '@/lib/multichatCommands';
import { acquirePreviewIdentity } from '@/features/multichat/previewIdentityClient';
import type { PreviewIdentityResponse } from '@/features/multichat/previewIdentity';
import { SUPPORT_AMOUNT_LABEL } from '@/lib/supportPage';

export type BadgesUser = { id: string; login: string; displayName: string; avatarUrl?: string };
export type BadgesBadge = { id: string; title: string; url: string; owned: boolean; worn: boolean };
type MeState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; user: BadgesUser; badges: BadgesBadge[]; owner?: boolean };
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Where Twitch sign-in sends the visitor back: this page, or the generator
 * with the Badges popup open again. */
export function signInHref(next: string): string {
  return `/api/auth/twitch/login?next=${encodeURIComponent(next)}`;
}

export function parseMe(body: unknown): MeState {
  if (!body || typeof body !== 'object') return { kind: 'unavailable' };
  const b = body as { user?: unknown; badges?: unknown; owner?: unknown };
  if (!b.user) return { kind: 'signed-out' };
  const u = b.user as Partial<BadgesUser>;
  if (typeof u.id !== 'string' || typeof u.login !== 'string' || typeof u.displayName !== 'string') {
    return { kind: 'unavailable' };
  }
  const badges = Array.isArray(b.badges)
    ? (b.badges as Partial<BadgesBadge>[]).filter((x): x is BadgesBadge => (
      typeof x.id === 'string' && typeof x.title === 'string' && typeof x.url === 'string'
      && typeof x.owned === 'boolean' && typeof x.worn === 'boolean'
    ))
    : [];
  return {
    kind: 'signed-in',
    user: {
      id: u.id,
      login: u.login,
      displayName: u.displayName,
      ...(typeof u.avatarUrl === 'string' ? { avatarUrl: u.avatarUrl } : {}),
    },
    badges,
    ...(b.owner === true ? { owner: true } : {}),
  };
}

/* Owner only: reload open overlays right away, every one or just the ones
   showing a given channel. */
const OWNER_REFRESH_PLATFORMS: readonly { value: string; label: string }[] = [
  { value: 'any', label: 'Any platform' },
  { value: 'twitch', label: 'Twitch' },
  { value: 'kick', label: 'Kick' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'tiktok', label: 'TikTok' },
];

function RefreshAllOverlays() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const click = async () => {
    if (state === 'sending') return;
    setState('sending');
    try {
      const response = await fetch('/api/overlay/refresh', { method: 'POST', cache: 'no-store' });
      const body = await response.json().catch(() => null) as { error?: unknown } | null;
      if (response.ok) {
        setState('sent');
        setMessage('Sent. Every open overlay is reloading now.');
      } else {
        setState('error');
        setMessage(typeof body?.error === 'string' ? body.error : 'That did not work.');
      }
    } catch {
      setState('error');
      setMessage('That did not work.');
    }
  };
  return (
    <div className="fc-owner-tool">
      <h3>All overlays</h3>
      <p className="fc-fine">Reloads every FlossChat chat overlay and FlossCounter that is open anywhere, right away, so they pick up the latest release.</p>
      <button type="button" className="fc-owner-button" onClick={() => { void click(); }} disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending\u2026' : 'Refresh all overlays'}
      </button>
      {message ? <p className="fc-fine" role="status">{message}</p> : null}
    </div>
  );
}

function RefreshOneChannel() {
  const [platform, setPlatform] = useState('any');
  const [channel, setChannel] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = channel.trim().replace(/^[@#]/, '');
    if (!name) {
      setState('error');
      setMessage('Enter a channel name first.');
      return;
    }
    setState('sending');
    try {
      const response = await fetch('/api/overlay/refresh', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, channel: name }),
      });
      const body = await response.json().catch(() => null) as { error?: unknown } | null;
      if (response.ok) {
        const where = OWNER_REFRESH_PLATFORMS.find((option) => option.value === platform);
        setState('sent');
        setMessage(`Sent. Overlays showing ${name}${platform === 'any' ? '' : ` on ${where?.label ?? platform}`} are reloading now.`);
      } else {
        setState('error');
        setMessage(typeof body?.error === 'string' ? body.error : 'That did not work.');
      }
    } catch {
      setState('error');
      setMessage('That did not work.');
    }
  };
  return (
    <form className="fc-owner-tool" onSubmit={(event) => { void submit(event); }}>
      <h3>One channel</h3>
      <p className="fc-fine">Reloads only the chat overlays and FlossCounters showing this channel.</p>
      <div className="fc-owner-row">
        <select
          aria-label="Platform"
          value={platform}
          onChange={(event) => setPlatform(event.target.value)}
        >
          {OWNER_REFRESH_PLATFORMS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <input
          aria-label="Channel name"
          placeholder="Channel name"
          value={channel}
          maxLength={80}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => { setChannel(event.target.value); if (state === 'error') setState('idle'); }}
        />
        <button type="submit" className="fc-owner-button" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending\u2026' : 'Refresh this channel'}
        </button>
      </div>
      {message && state !== 'idle' ? <p className="fc-fine" role="status">{message}</p> : null}
    </form>
  );
}

function RunOwnerCommand() {
  const [platform, setPlatform] = useState('any');
  const [channel, setChannel] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<MultichatCommand | null>(null);
  const [details, setDetails] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const matches = useMemo(() => {
    const wanted = search.trim().toLowerCase().replace(/^!?(flosschat\s+)?/, '');
    if (!wanted) return OWNER_RUNNABLE_COMMANDS;
    return OWNER_RUNNABLE_COMMANDS.filter((command) => (
      command.name.includes(wanted)
      || (command.aliases ?? []).some((alias) => alias.includes(wanted))
      || command.summary.toLowerCase().split(/[^a-z0-9]+/).some((word) => word.startsWith(wanted))
    ));
  }, [search]);

  const fail = (text: string) => {
    setState('error');
    setMessage(text);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = channel.trim().replace(/^[@#]/, '');
    if (!name) return fail('Enter a channel name first.');
    if (!picked) return fail('Pick a command from the list.');
    const extra = details.trim();
    if (ownerCommandArguments(picked).startsWith('<') && !extra) {
      return fail(`!flosschat ${picked.name} needs ${ownerCommandArguments(picked)}.`);
    }
    const text = `${picked.name}${extra ? ` ${extra}` : ''}`;
    setState('sending');
    try {
      const response = await fetch('/api/overlay/refresh', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, channel: name, command: text }),
      });
      const body = await response.json().catch(() => null) as { error?: unknown } | null;
      if (response.ok) {
        const where = OWNER_REFRESH_PLATFORMS.find((option) => option.value === platform);
        setState('sent');
        setMessage(`Sent. Overlays showing ${name}${platform === 'any' ? '' : ` on ${where?.label ?? platform}`} are running !flosschat ${text} now.`);
      } else {
        fail(typeof body?.error === 'string' ? body.error : 'That did not work.');
      }
    } catch {
      fail('That did not work.');
    }
  };

  return (
    <form className="fc-owner-tool" onSubmit={(event) => { void submit(event); }}>
      <h3>Run a command</h3>
      <p className="fc-fine">Runs a !flosschat command on the overlays showing this channel, as if the streamer typed it. Nothing is posted in their chat.</p>
      <div className="fc-owner-row">
        <select aria-label="Command platform" value={platform} onChange={(event) => setPlatform(event.target.value)}>
          {OWNER_REFRESH_PLATFORMS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <input
          aria-label="Command channel name"
          placeholder="Channel name"
          value={channel}
          maxLength={80}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => { setChannel(event.target.value); if (state === 'error') setState('idle'); }}
        />
      </div>
      <div className="fc-owner-row">
        <input
          aria-label="Search commands"
          placeholder="Search commands (reload, tts, img…)"
          value={search}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <ul className="fc-owner-commands" aria-label="Commands">
        {matches.map((command) => (
          <li key={command.name}>
            <button
              type="button"
              aria-pressed={picked?.name === command.name}
              onClick={() => { setPicked(command); setDetails(''); if (state === 'error') setState('idle'); }}
            >
              <code>{command.name}</code>
              <span>{command.summary}</span>
            </button>
          </li>
        ))}
        {matches.length === 0 ? <li className="fc-fine">No command matches.</li> : null}
      </ul>
      {picked ? (
        <div className="fc-owner-row">
          <code className="fc-owner-picked">!flosschat {picked.name}</code>
          {ownerCommandTakesArguments(picked) ? (
            <input
              aria-label="Command details"
              placeholder={ownerCommandArguments(picked)}
              value={details}
              maxLength={OWNER_COMMAND_MAX_LENGTH - picked.name.length - 1}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => { setDetails(event.target.value); if (state === 'error') setState('idle'); }}
            />
          ) : null}
          <button type="submit" className="fc-owner-button" disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending\u2026' : 'Run command'}
          </button>
        </div>
      ) : null}
      {message && state !== 'idle' ? <p className="fc-fine" role="status">{message}</p> : null}
    </form>
  );
}

export type GivenBadgeRow = { id: string; login: string; displayName: string; givenAt: string };

/** The given-badges list from /api/badges/give, keeping only well-formed rows. */
export function parseGivenBadges(value: unknown): GivenBadgeRow[] {
  const list = (value as { given?: unknown } | null)?.given;
  if (!Array.isArray(list)) return [];
  return list.filter((row): row is GivenBadgeRow => (
    typeof row === 'object' && row !== null
    && typeof (row as GivenBadgeRow).id === 'string'
    && typeof (row as GivenBadgeRow).login === 'string'
    && typeof (row as GivenBadgeRow).displayName === 'string'
    && typeof (row as GivenBadgeRow).givenAt === 'string'
  ));
}

function GiveBadge() {
  const [login, setLogin] = useState('');
  const [given, setGiven] = useState<GivenBadgeRow[]>([]);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let live = true;
    fetch('/api/badges/give', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (live) setGiven(parseGivenBadges(body)); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const send = async (payload: Record<string, string>) => {
    setState('sending');
    try {
      const response = await fetch('/api/badges/give', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) {
        setState('error');
        setMessage(typeof body?.error === 'string' ? body.error : 'That did not work.');
        return null;
      }
      return body;
    } catch {
      setState('error');
      setMessage('That did not work.');
      return null;
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = login.trim().replace(/^@/, '');
    if (!name) {
      setState('error');
      setMessage('Enter a Twitch username first.');
      return;
    }
    const body = await send({ login: name });
    const row = body ? parseGivenBadges({ given: [body.given] })[0] : undefined;
    if (!row) return;
    setGiven((current) => [row, ...current.filter((item) => item.id !== row.id)]);
    setLogin('');
    setState('sent');
    setMessage(`Given. ${row.displayName} has the badge now; overlays show it within about 15 seconds.`);
  };

  const takeBack = async (row: GivenBadgeRow) => {
    const body = await send({ takeBack: row.id });
    if (!body) return;
    setGiven((current) => current.filter((item) => item.id !== row.id));
    setState('sent');
    setMessage(`Taken back from ${row.displayName}.`);
  };

  return (
    <form className="fc-owner-tool" onSubmit={(event) => { void submit(event); }}>
      <h3>Give a badge</h3>
      <p className="fc-fine">Free, for tests and giveaways. It goes on that Twitch account right away. A badge someone paid for can only be taken back with a PayPal refund.</p>
      <div className="fc-owner-row">
        <input
          aria-label="Give to (Twitch username)"
          placeholder="Twitch username"
          value={login}
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => { setLogin(event.target.value); if (state === 'error') setState('idle'); }}
        />
        <button type="submit" className="fc-owner-button" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending\u2026' : 'Give badge'}
        </button>
      </div>
      {message && state !== 'idle' ? <p className="fc-fine" role="status">{message}</p> : null}
      {given.length > 0 ? (
        <ul className="fc-owner-given" aria-label="Badges given">
          {given.map((row) => (
            <li key={row.id}>
              <span>
                <strong>{row.displayName}</strong> <span className="fc-fine">@{row.login} · {new Date(row.givenAt).toLocaleDateString()}</span>
              </span>
              <button
                type="button"
                className="fc-owner-button"
                aria-label={`Take back from ${row.login}`}
                disabled={state === 'sending'}
                onClick={() => { void takeBack(row); }}
              >
                Take back
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

function OwnerTools() {
  return (
    <section className="fc-card fc-owner" aria-labelledby="fc-owner-title">
      <h2 id="fc-owner-title">Owner tools</h2>
      <RefreshAllOverlays />
      <RefreshOneChannel />
      <RunOwnerCommand />
      <GiveBadge />
    </section>
  );
}

/** Preview identity without our own badge, so wearing/taking it off is what decides. */
function withoutFlossChatBadge(identity: PreviewIdentityResponse | null): PreviewIdentityResponse | null {
  if (!identity?.communityBadges?.length) return identity;
  return {
    ...identity,
    communityBadges: identity.communityBadges.filter((badge) => !/gxufy/i.test(badge.type)),
  };
}

function signInNote(flag: string | null): string {
  if (flag === 'cancelled') return 'Sign-in was cancelled.';
  if (flag === 'failed') return 'Sign-in did not work. Please try again.';
  return '';
}

export type BadgesDashboardProps = {
  /** 'modal' inside the generator's Badges popup; 'page' on /badges. */
  variant?: 'page' | 'modal';
  /** Path to come back to after Twitch sign-in. */
  signInNext?: string;
  /** Popup only: open the Support popup instead of going to /support. */
  onGetBadge?: () => void;
};

export default function BadgesDashboard({
  variant = 'page',
  signInNext = '/badges',
  onGetBadge,
}: BadgesDashboardProps = {}) {
  const isModal = variant === 'modal';
  const [me, setMe] = useState<MeState>({ kind: 'loading' });
  const [save, setSave] = useState<SaveState>('idle');
  const [note, setNote] = useState('');
  const [identity, setIdentity] = useState<PreviewIdentityResponse | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('signin');
    if (flag) {
      setNote(signInNote(flag));
      params.delete('signin');
      const rest = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
    }
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (response) => {
        const body = response.ok ? await response.json().catch(() => null) : null;
        if (!cancelled) setMe(response.ok ? parseMe(body) : { kind: 'unavailable' });
      })
      .catch(() => {
        if (!cancelled) setMe({ kind: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = me.kind === 'signed-in' ? me.user.login : null;
  const userId = me.kind === 'signed-in' ? me.user.id : null;

  /* The real chat look: Twitch/FFZ/BTTV/7TV badges and the 7TV paint. */
  useEffect(() => {
    if (!login || !userId) return;
    let cancelled = false;
    const acquired = acquirePreviewIdentity(login);
    const accept = (response: PreviewIdentityResponse) => {
      if (!cancelled && response.identity.userId === userId) setIdentity(response);
    };
    void acquired.promise.then(accept).catch(() => undefined).finally(() => acquired.release());
    void acquired.enrichment.then(accept).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [login, userId]);

  const flossChat = me.kind === 'signed-in' ? me.badges.find((badge) => badge.id === 'supporter') ?? null : null;
  const worn = Boolean(flossChat?.owned && flossChat.worn);

  const previewBadges = useMemo(
    () => buildSupportBadgePreview(withoutFlossChatBadge(identity), [], null, worn),
    [identity, worn],
  );
  const nameStyle = useMemo(() => buildSupportUsernameStyle(identity), [identity]);

  const toggle = useCallback(async () => {
    if (me.kind !== 'signed-in' || !flossChat?.owned || save === 'saving') return;
    const next = !flossChat.worn;
    const apply = (value: boolean) => setMe((current) => (
      current.kind === 'signed-in'
        ? { ...current, badges: current.badges.map((badge) => (badge.id === flossChat.id ? { ...badge, worn: value } : badge)) }
        : current
    ));
    apply(next);
    setSave('saving');
    try {
      const response = await fetch('/api/badges/wear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badgeId: flossChat.id, worn: next }),
        cache: 'no-store',
      });
      if (response.status === 401) {
        setMe({ kind: 'signed-out' });
        setNote('Your sign-in expired. Please sign in again.');
        setSave('idle');
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      setSave('saved');
    } catch {
      apply(!next);
      setSave('error');
    }
  }, [me, flossChat, save]);

  useEffect(() => {
    if (save !== 'saved') return;
    const timer = window.setTimeout(() => setSave('idle'), 2200);
    return () => window.clearTimeout(timer);
  }, [save]);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' }).catch(() => undefined);
    setIdentity(null);
    setMe({ kind: 'signed-out' });
  }

  return (
    <div className={`fc-badges${isModal ? ' is-modal' : ''}`}>
      <style dangerouslySetInnerHTML={{ __html: `${MOTION_BASE_CSS}\n${BADGES_CSS}` }} />
      {isModal ? null : (
      <header className="fc-bar">
        <a className="fc-brand" href="/multichat" aria-label="FlossChat">
          <img src="/flosschat-logo.png" alt="" width={127} height={192} />
          <span>FlossChat</span>
        </a>
        <nav className="fc-nav" aria-label="Pages">
          <a href="/multichat">Overlay</a>
          <a href="/support">Support</a>
          <a href="/badges" aria-current="page">Badges</a>
        </nav>
        {me.kind === 'signed-in' ? (
          <div className="fc-user">
            {me.user.avatarUrl ? <img src={me.user.avatarUrl} alt="" className="fc-avatar" /> : null}
            <span className="fc-handle">@{me.user.login}</span>
            <button type="button" className="fc-ghost" onClick={signOut}>Sign out</button>
          </div>
        ) : <span />}
      </header>
      )}

      <main className="fc-main">
        <div className="fc-heading">
          <div>
            {isModal ? <h2 className="fc-title">Your badges</h2> : <h1 className="fc-title">Your badges</h1>}
            <p>What shows beside your name in FlossChat overlays.</p>
            {isModal && me.kind === 'signed-in' ? (
              <div className="fc-user is-inline">
                {me.user.avatarUrl ? <img src={me.user.avatarUrl} alt="" className="fc-avatar" /> : null}
                <span className="fc-handle">@{me.user.login}</span>
                <button type="button" className="fc-ghost" onClick={signOut}>Sign out</button>
              </div>
            ) : null}
          </div>
          <span className={`fc-save is-${save}`} role="status" aria-live="polite">
            {save === 'saving' ? 'Saving…' : save === 'saved' ? '✓ Saved' : save === 'error' ? 'Could not save' : ''}
          </span>
        </div>

        {note ? <p className="fc-note" role="status">{note}</p> : null}

        {me.kind === 'loading' ? (
          <section className="fc-card fc-skeleton" aria-busy="true"><div /><div /></section>
        ) : me.kind === 'unavailable' ? (
          <section className="fc-card fc-empty">
            <h2>Sign-in is not available right now</h2>
            <p>Please try again in a little while.</p>
          </section>
        ) : me.kind === 'signed-out' ? (
          <section className="fc-card fc-signin">
            <img className="fc-signin-badge" src="/badges/gxufy/supporter-hand.webp" alt="" />
            <h2>Sign in to manage your badge</h2>
            <p>Wear or take off your FlossChat badge. Changes show in chat within seconds.</p>
            <a className="fc-twitch" href={signInHref(signInNext)}>
              <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M4.3 3 3 6.3v13.2h4.5V22h2.5l2.5-2.5h3.7l5-5V3H4.3Zm15.2 10.6-2.9 2.9H12l-2.5 2.5v-2.5H5.8V4.7h13.7v8.9ZM16.3 7.6v5h-1.8v-5h1.8Zm-4.5 0v5H10v-5h1.8Z" />
              </svg>
              Sign in with Twitch
            </a>
            <p className="fc-fine">Only reads your Twitch name. No permissions, nothing posted.</p>
          </section>
        ) : (
          <div className="fc-grid">
            <section className="fc-card" aria-labelledby="fc-badges-title">
              <h2 id="fc-badges-title">FlossChat badge</h2>
              <p className="fc-sub">
                {flossChat?.owned
                  ? 'Click to wear it. Click again to take it off.'
                  : `You don\u2019t have this badge yet. It\u2019s yours with a one-time tip of ${SUPPORT_AMOUNT_LABEL} or more, and goes to @${me.user.login} when you choose \u201cFor you\u201d.`}
              </p>
              <div className="fc-tiles">
                {flossChat ? (
                  flossChat.owned ? (
                    <button
                      type="button"
                      className={`fc-tile${flossChat.worn ? ' is-worn' : ''}`}
                      aria-pressed={flossChat.worn}
                      onClick={toggle}
                      disabled={save === 'saving'}
                    >
                      <img src={flossChat.url} alt="" />
                      <span className="fc-tile-name">{flossChat.title}</span>
                      <span className="fc-tile-state">{flossChat.worn ? 'Wearing' : 'Not shown'}</span>
                    </button>
                  ) : onGetBadge ? (
                    <button type="button" className="fc-tile is-locked" onClick={onGetBadge}>
                      <img src={flossChat.url} alt="" />
                      <span className="fc-tile-name">{flossChat.title}</span>
                      <span className="fc-tile-state">Get it from {SUPPORT_AMOUNT_LABEL}</span>
                    </button>
                  ) : (
                    <a className="fc-tile is-locked" href="/support">
                      <img src={flossChat.url} alt="" />
                      <span className="fc-tile-name">{flossChat.title}</span>
                      <span className="fc-tile-state">Get it from {SUPPORT_AMOUNT_LABEL}</span>
                    </a>
                  )
                ) : null}
              </div>
            </section>

            <section className="fc-card fc-preview" aria-labelledby="fc-preview-title">
              <h2 id="fc-preview-title">Live preview</h2>
              <div className="fc-chat" aria-label="How your name looks in chat">
                <div className="fc-chat-row">
                  {previewBadges.map((badge) => (
                    <img
                      key={badge.key}
                      className={`fc-chat-badge${badge.key.startsWith('gxufy:') ? ' is-flosschat' : ''}`}
                      src={badge.url}
                      alt={badge.title}
                      title={badge.title}
                    />
                  ))}
                  <strong className="fc-chat-name" style={nameStyle}>{me.user.displayName}</strong>
                  <span className="fc-chat-text">: hey chat</span>
                </div>
              </div>
              <p className="fc-fine">Your Twitch, 7TV, BTTV and FFZ badges and paint, as FlossChat shows them.</p>
            </section>
            {me.owner ? <OwnerTools /> : null}
          </div>
        )}
      </main>
    </div>
  );
}

const BADGES_CSS = `
.fc-badges {
  --bg: #141418; --card: #1d1d23; --card-2: #24242c; --line: #2c2c35;
  --text: #e2e2e8; --muted: #9a9aa5; --dim: #62626e; --accent: #4a84fa; --ok: #2fbf71; --err: #ee7777;
  --twitch: #9146ff;
  min-height: 100vh; background: var(--bg); color: var(--text);
  background-image: radial-gradient(ellipse 900px 420px at 50% -80px, rgba(74,132,250,.09), transparent);
  font-family: 'Montserrat', 'Noto Sans JP', system-ui, sans-serif;
}
.fc-badges *, .fc-badges *::before, .fc-badges *::after { box-sizing: border-box; }
.fc-bar {
  position: sticky; top: 0; z-index: 5; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
  gap: 16px; padding: 10px 20px; background: rgba(20,20,24,.78); backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}
.fc-brand { display: inline-flex; align-items: center; gap: 10px; color: #fff; text-decoration: none; font-weight: 800; letter-spacing: -.03em; }
.fc-brand img { height: 30px; width: auto; }
.fc-nav { display: flex; gap: 4px; }
.fc-nav a { color: var(--muted); text-decoration: none; font-size: .86rem; font-weight: 600; padding: 7px 12px; border-radius: 999px; }
.fc-nav a:hover { color: var(--text); background: var(--card); }
.fc-nav a[aria-current="page"] { color: #fff; background: var(--card-2); }
.fc-user { justify-self: end; display: flex; align-items: center; gap: 8px; }
.fc-owner-button {
  margin-top: 10px; padding: 10px 16px; border-radius: 10px; border: 1px solid var(--line);
  background: var(--card-2); color: var(--text); font: inherit; font-weight: 700; cursor: pointer;
}
.fc-owner-button:hover:not(:disabled) { border-color: var(--accent); }
.fc-owner-button:disabled { opacity: .6; cursor: default; }
.fc-owner-tool { margin-top: 16px; }
.fc-owner-tool + .fc-owner-tool { padding-top: 16px; border-top: 1px solid var(--line); }
.fc-owner-tool h3 { margin: 0 0 4px; font-size: .95rem; font-weight: 700; }
.fc-owner-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.fc-owner-row .fc-owner-button { margin-top: 0; }
.fc-owner-row select, .fc-owner-row input {
  padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line);
  background: var(--card-2); color: var(--text); font: inherit;
}
.fc-owner-row input { flex: 1 1 180px; min-width: 0; }
.fc-owner-row select:focus-visible, .fc-owner-row input:focus-visible { outline: none; border-color: var(--accent); }
.fc-owner-commands {
  list-style: none; margin: 10px 0 0; padding: 4px; max-height: 240px; overflow-y: auto;
  border: 1px solid var(--line); border-radius: 10px; background: var(--card-2);
}
.fc-owner-commands button {
  display: flex; gap: 10px; align-items: baseline; width: 100%; text-align: left;
  padding: 7px 10px; border: 1px solid transparent; border-radius: 8px;
  background: none; color: var(--text); font: inherit; font-size: .86rem; cursor: pointer;
}
.fc-owner-commands button:hover { background: var(--card); }
.fc-owner-commands button[aria-pressed="true"] { border-color: var(--accent); background: var(--card); }
.fc-owner-commands code { flex: 0 0 9.5em; font-weight: 700; color: #fff; }
.fc-owner-commands span { color: var(--muted); }
.fc-owner-commands .fc-fine { padding: 7px 10px; }
.fc-owner-picked { align-self: center; font-weight: 700; color: #fff; }
.fc-owner-given { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 6px; }
.fc-owner-given li {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 6px 6px 6px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--card-2);
}
.fc-owner-given li > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fc-owner-given .fc-owner-button { flex: 0 0 auto; white-space: nowrap; padding: 7px 12px; font-size: .86rem; }
.fc-avatar { width: 28px; height: 28px; border-radius: 50%; }
.fc-handle { font-size: .86rem; font-weight: 600; }
.fc-ghost {
  font: inherit; font-size: .78rem; color: var(--muted); background: transparent; border: 1px solid var(--line);
  border-radius: 999px; padding: 5px 11px; cursor: pointer;
}
.fc-ghost:hover { color: var(--text); border-color: var(--dim); }
.fc-main { max-width: 920px; margin: 0 auto; padding: 32px 20px 64px; }
.fc-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.fc-heading .fc-title { margin: 0; font-size: 1.8rem; font-weight: 800; letter-spacing: -.04em; color: #fff; }
.fc-heading p { margin: 4px 0 0; color: var(--muted); font-size: .92rem; }
.fc-save { font-size: .8rem; font-weight: 600; color: var(--muted); padding: 5px 10px; border-radius: 999px; min-height: 26px; }
.fc-save.is-saved { color: var(--ok); background: rgba(47,191,113,.1); }
.fc-save.is-error { color: var(--err); background: rgba(238,119,119,.1); }
.fc-save.is-idle { visibility: hidden; }
.fc-note { margin: 0 0 14px; padding: 10px 14px; border-radius: 10px; background: var(--card); border: 1px solid var(--line); color: var(--muted); font-size: .88rem; }
.fc-card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; box-shadow: 0 4px 24px rgba(0,0,0,.35); }
.fc-card h2 { margin: 0; font-size: 1rem; font-weight: 700; color: #fff; }
.fc-sub { margin: 4px 0 16px; color: var(--muted); font-size: .86rem; }
.fc-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 16px; }
.fc-tiles { display: flex; flex-wrap: wrap; gap: 12px; }
.fc-tile {
  font: inherit; color: inherit; text-decoration: none; cursor: pointer; width: 132px;
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 10px 12px;
  background: var(--card-2); border: 1px solid var(--line); border-radius: 14px; position: relative;
}
.fc-tile img { width: 56px; height: 56px; object-fit: contain; filter: drop-shadow(0 4px 10px rgba(0,0,0,.5)); }
.fc-tile-name { font-weight: 700; font-size: .86rem; color: #fff; }
.fc-tile-state { font-size: .72rem; color: var(--muted); }
.fc-tile:hover { border-color: var(--dim); }
.fc-tile.is-worn { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 6px 22px rgba(74,132,250,.22); }
.fc-tile.is-worn .fc-tile-state { color: var(--accent); font-weight: 700; }
.fc-tile.is-locked img { filter: grayscale(.7) brightness(.7); }
.fc-tile:disabled { cursor: progress; }
.fc-chat {
  margin-top: 14px; padding: 22px 18px; border-radius: 12px; border: 1px solid var(--line);
  background-color: #2a2a2a;
  background-image: linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%);
  background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0;
}
.fc-chat-row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; font-size: 22px; font-weight: 800; color: #fff; text-shadow: rgba(0,0,0,.8) 2px 3px .15rem; }
.fc-chat-badge { width: 28px; height: 28px; object-fit: contain; filter: drop-shadow(rgba(0,0,0,.8) 1px 2px 2px); }
.fc-chat-name { margin-left: 4px; letter-spacing: -.01em; }
.fc-chat-text { font-weight: 600; }
.fc-fine { margin: 12px 0 0; color: var(--dim); font-size: .76rem; }
.fc-signin { text-align: center; padding: 44px 24px; }
.fc-signin p { max-width: 420px; margin-left: auto; margin-right: auto; }
.fc-signin-badge { display: block; margin: 0 auto; width: 72px; height: 72px; object-fit: contain; filter: drop-shadow(0 8px 18px rgba(0,0,0,.55)); }
.fc-signin h2 { font-size: 1.25rem; margin-top: 14px; }
.fc-signin p { color: var(--muted); font-size: .9rem; }
.fc-twitch {
  display: inline-flex; align-items: center; gap: 9px; margin-top: 10px; padding: 11px 20px;
  background: var(--twitch); color: #fff; text-decoration: none; font-weight: 700; border-radius: 12px;
  box-shadow: 0 6px 20px rgba(145,70,255,.3);
}
.fc-twitch:hover { background: #a167ff; }
.fc-empty { text-align: center; }
.fc-empty p { color: var(--muted); }
.fc-skeleton { display: grid; gap: 12px; }
.fc-skeleton div { height: 18px; border-radius: 8px; background: var(--card-2); }
.fc-skeleton div:first-child { width: 40%; }
.fc-twitch:focus-visible, .fc-tile:focus-visible, .fc-ghost:focus-visible, .fc-nav a:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
.fc-badges.is-modal { min-height: 0; background: #17171c; background-image: none; border: 1px solid var(--line);
  border-radius: 22px; box-shadow: 0 24px 80px rgba(0,0,0,.55); }
.fc-badges.is-modal .fc-main { padding: 26px 24px 24px; }
.fc-badges.is-modal .fc-heading { padding-right: 44px; }
.fc-badges.is-modal .fc-title { font-size: 1.45rem; }
.fc-badges.is-modal .fc-card { box-shadow: none; }
.fc-user.is-inline { justify-self: auto; margin-top: 10px; }
@media (max-width: 720px) {
  .fc-grid { grid-template-columns: 1fr; }
  .fc-bar { grid-template-columns: auto 1fr; }
  .fc-nav { display: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .fc-card { animation: gx-rise-in .45s var(--ease-out) backwards; }
  .fc-grid > .fc-card:nth-child(2) { animation-delay: .05s; }
  .fc-save.is-saved, .fc-save.is-error, .fc-note { animation: gx-pop-in .22s var(--ease-out) backwards; }
  .fc-tile, .fc-twitch, .fc-ghost, .fc-nav a {
    transition: color var(--dur-fast) var(--ease-standard), background-color var(--dur-fast) var(--ease-standard),
      border-color var(--dur-fast) var(--ease-standard), box-shadow .25s var(--ease-standard), scale .4s var(--ease-spring);
  }
  .fc-tile:not(:disabled):active, .fc-twitch:active, .fc-ghost:active { scale: .97; }
  .fc-tile img, .fc-chat-badge { transition: scale .45s var(--ease-spring), opacity .2s var(--ease-standard); }
  .fc-tile.is-worn img { scale: 1.06; }
  .fc-chat-badge.is-flosschat { animation: gx-pop-in .3s var(--ease-out) backwards; }
  .fc-skeleton div { animation: gx-fade-in 1s var(--ease-standard) infinite alternate; }
}
`;
