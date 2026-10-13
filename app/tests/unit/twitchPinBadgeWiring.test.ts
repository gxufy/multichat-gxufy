import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/multichat.tsx'),
  'utf8',
);

describe('Twitch pinned-message badge wiring', () => {
  it('resolves official badge artwork while converting a new pin', () => {
    expect(SOURCE).toContain(
      'function toUnifiedTwitchPin(pin: TwitchPinApiMessage, badgeMap: Record<string, string> = {})',
    );

    expect(SOURCE).toContain(
      'badgeMap[`${badge.type}/${badge.version}`] ?? badgeMap[`${badge.type}/1`]',
    );

    expect(SOURCE).toContain(
      'toUnifiedTwitchPin(pin, twitchBadgeMapRef.current)',
    );
  });

  it('keeps the latest Twitch badge map for pins that arrive later', () => {
    expect(SOURCE).toContain(
      'const twitchBadgeMapRef = useRef<Record<string, string>>({});',
    );

    expect(SOURCE).toContain(
      'twitchBadgeMapRef.current = badgeMap;',
    );
  });

  it('repaints visible fallback badges when authoritative channel art arrives', () => {
    const start = SOURCE.indexOf('onBadgeMap: (badgeMap) => {');
    expect(start).toBeGreaterThan(-1);

    const end = SOURCE.indexOf('/* A pin can arrive before', start);
    expect(end).toBeGreaterThan(start);

    const region = SOURCE.slice(start, end);
    expect(region).toContain('s.messages = s.messages.map((message) => {');
    expect(region).toContain("if (message.platform !== 'twitch' || !message.raw) return message;");
    expect(region).toContain('const raw = message.raw as UnifiedMessage;');
    expect(region).toContain('const badges = raw.badges.map((badge) => {');
    expect(region).toContain('badgeMap[`${badge.type}/${version}`] ?? badgeMap[`${badge.type}/1`]');
    expect(region).toContain('return rebuildParsed(message, { ...raw, badges });');
    expect(region).toContain('scheduleMessagePersistence();');
    expect(region).toContain('markDirty();');
  });

  it('repaints an already-visible Twitch pin when badge art arrives', () => {
    const start = SOURCE.indexOf('onBadgeMap: (badgeMap) => {');
    expect(start).toBeGreaterThan(-1);

    const end = SOURCE.indexOf('onStatus:', start);
    expect(end).toBeGreaterThan(start);

    const region = SOURCE.slice(start, end);

    expect(region).toContain('setPinnedMessage(prev => {');
    expect(region).toContain(
      "if (!prev || prev.msg.platform !== 'twitch' || !prev.msg.raw) return prev;",
    );
    expect(region).toContain(
      'const raw = prev.msg.raw as UnifiedMessage;',
    );
    expect(region).toContain(
      'msg: rebuildParsed(prev.msg, { ...raw, badges })',
    );
  });

  it('preserves the pin identity so late artwork cannot restart PinBanner', () => {
    const start = SOURCE.indexOf('onBadgeMap: (badgeMap) => {');
    const end = SOURCE.indexOf('onStatus:', start);
    const region = SOURCE.slice(start, end);

    expect(region).toContain('msg: rebuildParsed(prev.msg, { ...raw, badges })');
    expect(SOURCE).toContain('id: previous.id');
    expect(SOURCE).toContain('timestamp: previous.timestamp');

    // Repainting state directly avoids handing the pin back through the
    // normal pin-installation path, which would risk resetting ownership.
    expect(region).not.toContain('pinHandlerRef.current?.(');
  });

  it('drops channel-specific badge art when the Twitch connector is rebuilt', () => {
    const start = SOURCE.indexOf('if (cfg.twitch) {');
    expect(start).toBeGreaterThan(-1);

    const region = SOURCE.slice(start, start + 250);
    expect(region).toContain('twitchBadgeMapRef.current = {};');
  });
});
