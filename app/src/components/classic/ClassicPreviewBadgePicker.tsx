/* The preview badge, cosmetic and paint picker.
 *
 * WHAT THIS CHOOSES, AND WHAT IT DOES NOT. This picks the fake *identities* the
 * generated messages carry — which badge types, whose entitlements, which emote
 * sources. It does not decide whether any of that draws. The twenty-four chat
 * settings remain the authority: `sevenTVCosmeticsEnabled` gates 7TV badges and
 * paints together, `paintShadows` decides whether a paint keeps its shadow,
 * `sevenTVEmotesEnabled` gates the third-party emote swaps, and `sourceTag`
 * decides how a platform is marked. Every combination of "chip on, setting off"
 * is a preview showing nothing, and that is correct — so each chip carries a
 * description saying which setting gates it, because a chip promising paints
 * while paints are switched off otherwise reads as a bug.
 *
 * Platform badge *art* has no setting gating it: the catalog's twenty-four keys
 * include no badge-visibility toggle, and `renderBadges` runs unconditionally.
 * So the chips for platform, Twitch, Kick, YouTube, TikTok and FFZ badges are
 * ungated — they are the only authority over whether that art appears at all,
 * and their descriptions say nothing about a setting that does not exist.
 *
 * HONESTY ABOUT SOURCES. The list stops exactly where the renderer stops. Every
 * entry corresponds to a code path that exists: `renderBadges` resolves Twitch
 * types from the official table, draws Kick art including subscriber tiers and
 * gifter ranks, inlines YouTube moderator and verified art, and draws any badge
 * carrying a `url` directly — which is how TikTok's pre-resolved wide art and
 * FFZ's mod/vip room-badge overrides arrive. `buildParsedMessage` attaches 7TV
 * badges and paints from entitlements, and `lib/twitchEmotes` loads FFZ and BTTV
 * emotes into the same shape the 7TV loader fills. Nothing here offers animated
 * paints, because `buildPaintStyle` implements linear gradients, radial
 * gradients and image URLs and there is no animated path to exercise.
 *
 * Chips rather than nine pill switches: nine switches would stand taller than
 * the preview they describe. Each chip is a real checkbox, so the group is
 * keyboard-operable and announces its own checked state without `aria-pressed`.
 */
import {
  PREVIEW_SOURCES,
  PREVIEW_SOURCE_HINT,
  PREVIEW_SOURCE_LABEL,
  type PreviewSource,
  type PreviewSourceState,
} from '@/features/multichat/previewSimulator';

export default function ClassicPreviewBadgePicker({
  sources,
  onToggleSource,
  onEnableAll,
  onDisableAll,
  onRandomize,
  onReset,
}: {
  sources: PreviewSourceState;
  onToggleSource: (source: PreviewSource) => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  onRandomize: () => void;
  onReset: () => void;
}) {
  return (
    <fieldset
      className="classic-seg preview-feed-sources"
      aria-describedby="preview-feed-sources-help"
    >
      <legend>Preview badges &amp; cosmetics</legend>
      <p className="sr-only" id="preview-feed-sources-help">
        Chooses which fixture identities the fake messages use. The chat
        settings still decide how they draw: 7TV cosmetics gates 7TV badges and
        paints, paint shadows gates the glow, and source tags decides how a
        platform is marked. Platform badge art always draws.
      </p>
      <div className="preview-feed-chips">
        {PREVIEW_SOURCES.map((source) => (
          <span className="classic-chip preview-feed-chip" key={source}>
            <input
              type="checkbox"
              id={`preview-source-${source}`}
              checked={sources[source]}
              aria-describedby={`preview-source-${source}-hint`}
              onChange={() => onToggleSource(source)}
            />
            <label
              htmlFor={`preview-source-${source}`}
              className={`classic-chip-label${sources[source] ? ' on' : ''}`}
              title={PREVIEW_SOURCE_HINT[source]}
            >
              {PREVIEW_SOURCE_LABEL[source]}
            </label>
            {/* The hint is the accessible description rather than only a
                tooltip: a title attribute is not reliably announced, and the
                gating caveat is the part someone actually needs. */}
            <span className="sr-only" id={`preview-source-${source}-hint`}>
              {PREVIEW_SOURCE_HINT[source]}
            </span>
          </span>
        ))}
      </div>
      <div className="preview-feed-actions">
        <button type="button" className="classic-conn-btn" onClick={onEnableAll}>
          Enable all
        </button>
        <button type="button" className="classic-conn-btn" onClick={onDisableAll}>
          Disable all
        </button>
        <button type="button" className="classic-conn-btn" onClick={onRandomize}>
          Randomize badges
        </button>
        <button type="button" className="classic-conn-btn" onClick={onReset}>
          Reset badge selection
        </button>
      </div>
    </fieldset>
  );
}
