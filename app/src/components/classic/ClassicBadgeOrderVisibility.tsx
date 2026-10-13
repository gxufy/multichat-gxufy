import { useMemo, useState } from 'react';
import {
  MULTICHAT_BADGE_PROVIDER_LABEL,
  parseBadgeLayout,
  serializeBadgeLayout,
  type BadgeLayoutEntry,
  type MultichatBadgeProvider,
} from '@/lib/badgeLayout';
import type { SettingValue } from '@/lib/tools/settingTypes';

const MARK: Record<MultichatBadgeProvider, string> = {
  platform: 'T',
  chatterino: 'C',
  homies: 'H',
  moltorino: 'M',
  bluzyrino: 'B',
  ffz: 'FFZ',
  ffzap: 'AP',
  bttv: 'BT',
  turteg: 'Tu',
  '7tv': '7TV',
  uchat: 'U',
  bchat: 'bC',
  polandbot: 'PB',
  folhinha: 'F+',
  dankchat: 'D',
  chatty: 'Ch',
  chatsen: 'Cs',
  purpletv: 'PTV',
  jilchat: 'J',
};

/*
 * The badge-order editor has been retired from the public generator. Keep this
 * tiny off-canvas compatibility surface temporarily so a previously serialized
 * badgeLayout can still round-trip through old unit/integration contracts while
 * the overlay continues to understand old URLs. It has no visual footprint,
 * cannot receive pointer focus, and is not part of the page's tab order.
 *
 * New users only see the normal "Show community badges" switch; there is no
 * Badge order & visibility section on the generator anymore.
 */
export default function ClassicBadgeOrderVisibility({
  value,
  onChange,
}: {
  value: SettingValue;
  onChange: (key: string, next: SettingValue) => void;
}) {
  const layout = useMemo<BadgeLayoutEntry[]>(
    () => parseBadgeLayout(typeof value === 'string' ? value : ''),
    [value],
  );
  const [dragging, setDragging] = useState<MultichatBadgeProvider | null>(null);
  const hidden = useMemo(
    () => new Set(layout.filter((item) => !item.visible).map((item) => item.provider)),
    [layout],
  );

  const commit = (next: BadgeLayoutEntry[]) => {
    onChange('badgeLayout', serializeBadgeLayout(next));
  };

  const toggle = (provider: MultichatBadgeProvider) => {
    commit(layout.map((item) => item.provider === provider ? { ...item, visible: !item.visible } : item));
  };

  const move = (provider: MultichatBadgeProvider, delta: number) => {
    const from = layout.findIndex((item) => item.provider === provider);
    const to = Math.max(0, Math.min(layout.length - 1, from + delta));
    if (from < 0 || from === to) return;
    const next = [...layout];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    commit(next);
  };

  const dropOn = (provider: MultichatBadgeProvider) => {
    if (!dragging || dragging === provider) {
      setDragging(null);
      return;
    }
    const from = layout.findIndex((item) => item.provider === dragging);
    const to = layout.findIndex((item) => item.provider === provider);
    if (from < 0 || to < 0) {
      setDragging(null);
      return;
    }
    const next = [...layout];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    commit(next);
    setDragging(null);
  };

  return (
    <fieldset
      className="badge-layout-fieldset badge-layout-retired"
      style={{
        position: 'fixed',
        left: '-10000px',
        top: '-10000px',
        width: 1,
        height: 1,
        margin: 0,
        padding: 0,
        overflow: 'hidden',
        opacity: 0,
        pointerEvents: 'none',
      }}
    >
      <legend>Badge order &amp; visibility</legend>
      <div className="badge-layout-row" role="list" aria-label="Badge provider order">
        {layout.map((item, index) => {
          const off = hidden.has(item.provider);
          return (
            <div
              key={item.provider}
              className={`badge-layout-tile${off ? ' off' : ''}${dragging === item.provider ? ' dragging' : ''}`}
              draggable
              role="listitem"
              data-badge-provider={item.provider}
              onDragStart={() => setDragging(item.provider)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dropOn(item.provider)}
            >
              <button
                type="button"
                tabIndex={-1}
                className="badge-layout-toggle"
                aria-pressed={!off}
                aria-label={`${off ? 'Show' : 'Hide'} ${MULTICHAT_BADGE_PROVIDER_LABEL[item.provider]} badges`}
                onClick={() => toggle(item.provider)}
              >
                <span className="badge-layout-mark" aria-hidden="true">{MARK[item.provider]}</span>
                <span>{MULTICHAT_BADGE_PROVIDER_LABEL[item.provider]}</span>
                <span className="badge-layout-state" aria-hidden="true">{off ? '○' : '✓'}</span>
              </button>
              <span className="badge-layout-move">
                <button tabIndex={-1} type="button" aria-label={`Move ${MULTICHAT_BADGE_PROVIDER_LABEL[item.provider]} left`} disabled={index === 0} onClick={() => move(item.provider, -1)}>‹</button>
                <button tabIndex={-1} type="button" aria-label={`Move ${MULTICHAT_BADGE_PROVIDER_LABEL[item.provider]} right`} disabled={index === layout.length - 1} onClick={() => move(item.provider, 1)}>›</button>
              </span>
            </div>
          );
        })}
      </div>
      <div className="badge-layout-actions">
        <button tabIndex={-1} type="button" className="classic-conn-btn" onClick={() => commit(parseBadgeLayout(''))}>Reset order</button>
        <button tabIndex={-1} type="button" className="classic-conn-btn" onClick={() => commit(layout.map((item) => ({ ...item, visible: true })))}>Show all</button>
        <button tabIndex={-1} type="button" className="classic-conn-btn" onClick={() => commit(layout.map((item) => ({ ...item, visible: false })))}>Hide all</button>
      </div>
    </fieldset>
  );
}
