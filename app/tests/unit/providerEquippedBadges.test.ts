import { describe, expect, it } from 'vitest';
import { parseBluzyrino, parseMoltorinoV2 } from '../../src/lib/communityBadges';

const img = (id: string) => ({ '1x': `https://api.moltorino.com/badges/assets/${id}/1x.webp`, '3x': `https://api.moltorino.com/badges/assets/${id}/3x.webp` });

describe('Moltorino v2 equipped badge', () => {
  const body = {
    schemaVersion: 2,
    badges: [
      { id: 'contributor', tooltip: 'Moltorino Contributor', priority: 20, images: img('contributor') },
      { id: 'supporter_plus_alt', tooltip: 'Supporter+ Alt', priority: 80, images: img('supporter_plus_alt') },
      { id: 'supporter', tooltip: 'Moltorino Supporter', priority: 100, images: img('supporter') },
      { id: 'secret', tooltip: 'Secret', priority: 1, hidden: true, images: img('secret') },
    ],
    users: {
      '506954718': { badges: ['supporter', 'contributor', 'supporter_plus_alt'], activeBadge: 'supporter_plus_alt', hidden: ['ts'] },
      '204219574': { badges: ['supporter'] },
      '111': { badges: ['supporter', 'contributor'] },
      '222': { badges: ['secret', 'supporter'] },
      '333': { badges: ['supporter'], activeBadge: 'not-owned-or-unknown' },
    },
  };
  const owners = (id: string) => parseMoltorinoV2(body).find((a) => a.id === id)?.userIds ?? [];

  it('shows only the activeBadge the user equipped', () => {
    expect(owners('supporter_plus_alt')).toEqual(['506954718']);
    expect(owners('contributor')).not.toContain('506954718');
    expect(owners('supporter')).not.toContain('506954718');
  });

  it('falls back to the best-priority owned badge when nothing is equipped', () => {
    expect(owners('contributor')).toEqual(['111']);
    expect(owners('supporter')).toEqual(expect.arrayContaining(['204219574', '222', '333']));
  });

  it('never shows catalog-hidden badges', () => {
    expect(owners('secret')).toEqual([]);
  });

  it('gives each user exactly one Moltorino badge', () => {
    const all = parseMoltorinoV2(body).flatMap((a) => a.userIds);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('Bluzyrino equipped selection', () => {
  const badge = (id: string, category: string, users: string[]) => ({
    id, category, tooltip: id,
    image_url_4x: `https://bluzyrino-badge-registry.blu901-55.workers.dev/badges/${id}-72.webp`,
    users: users.map((u) => ({ id: u, login: `u${u}` })),
  });
  const body = {
    selections: { '1': { donor: 'tier1' }, '2': { donor: 'none' } },
    bchat: {
      badges: [
        badge('staff', 'special', ['1']),
        badge('early-supporter', 'donor', ['1', '2', '3']),
        badge('tier1', 'donor', ['1', '2']),
      ],
    },
  };
  const owners = (id: string) => parseBluzyrino(body).find((a) => a.id === id)?.userIds ?? [];

  it('shows the selected donor badge instead of other donor badges', () => {
    expect(owners('tier1')).toEqual(['1']);
    expect(owners('early-supporter')).not.toContain('1');
  });

  it('shows no donor badge for "none"', () => {
    expect(owners('tier1')).not.toContain('2');
    expect(owners('early-supporter')).not.toContain('2');
  });

  it('keeps unselected categories and users without selections', () => {
    expect(owners('staff')).toEqual(['1']);
    expect(owners('early-supporter')).toEqual(['3']);
  });
});
