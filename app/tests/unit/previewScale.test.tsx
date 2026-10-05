/* Preview-only zoom regression coverage.
 *
 * Zoom changes only the isolated preview frame. It never enters the MultiChat
 * config, generated URL, or production renderer settings. Retired pin state is
 * intentionally ignored by the serializer and therefore cannot resurrect a pin
 * banner in Preview Data.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import ClassicChatPreview from '@/components/classic/ClassicChatPreview';
import IsolatedPreviewFrame, {
  PREVIEW_SCALES,
  PREVIEW_SCALE_DEFAULT,
} from '@/components/classic/IsolatedPreviewFrame';
import { multichatTool } from '@/features/multichat/config';
import { MULTICHAT_OBS_SIZE } from '@/features/multichat/obs';
import { MULTICHAT_CATALOG } from '@/features/multichat/settings';
import {
  SAMPLE_COSMETICS,
  SAMPLE_PIN_BY,
  sampleAllMessages,
  sampleMessages,
} from '@/features/multichat/samples';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const queryFor = (style: Partial<Record<string, unknown>> = {}) =>
  multichatTool.serialize({}, { ...multichatTool.defaults, ...style } as never);

const CHAT_TITLE = 'MultiChat sample preview';
const frame = (title = CHAT_TITLE) =>
  document.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`)!;
const wrapper = (title = CHAT_TITLE) => frame(title).parentElement as HTMLElement;
const frameDoc = (title = CHAT_TITLE) => frame(title).contentDocument!;

function scaleFactor(title = CHAT_TITLE): number {
  const transform = frame(title).style.transform;
  if (!transform) return 1;
  const match = /scale\(([\d.]+)\)/.exec(transform);
  expect(match).not.toBeNull();
  return Number(match![1]);
}

const viewportPercent = (title = CHAT_TITLE) =>
  Number.parseFloat(frame(title).style.width);

function mountPreview(
  scale?: number,
  all = false,
  style: Partial<Record<string, unknown>> = {},
) {
  return render(
    <ClassicChatPreview
      query={queryFor(style)}
      messages={all ? sampleAllMessages() : sampleMessages()}
      cosmetics={SAMPLE_COSMETICS}
      width={MULTICHAT_OBS_SIZE.width}
      height={MULTICHAT_OBS_SIZE.height}
      {...(scale === undefined ? {} : { scale })}
    />,
  );
}

afterEach(cleanup);

describe('preview scale values', () => {
  it('keeps the supported scale steps and default', () => {
    expect([...PREVIEW_SCALES]).toEqual([65, 75, 85, 100]);
    expect(PREVIEW_SCALE_DEFAULT).toBe(75);
  });

  it('is not a serializable MultiChat setting', () => {
    const keys = MULTICHAT_CATALOG.map((setting) => String(setting.key));
    for (const forbidden of ['previewScale', 'scale', 'zoom', 'previewZoom']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(queryFor()).not.toMatch(/previewScale|previewZoom|zoom=/i);
  });
});

describe('isolated frame geometry', () => {
  it.each(PREVIEW_SCALES)('implements %i%% with reciprocal viewport geometry', (scale) => {
    mountPreview(scale);
    const factor = scale / 100;
    expect(scaleFactor()).toBeCloseTo(factor, 4);
    expect(viewportPercent()).toBeCloseTo(100 / factor, 3);
    expect(frame().style.transformOrigin).toBe('0 0');
    expect(wrapper().style.overflow).toBe('hidden');
    cleanup();
  });

  it('leaves full-size preview untransformed', () => {
    mountPreview(100);
    expect(frame().style.transform).toBe('');
    expect(viewportPercent()).toBeCloseTo(100, 3);
  });

  it('keeps the canonical outer aspect ratio at every scale', () => {
    for (const scale of PREVIEW_SCALES) {
      mountPreview(scale);
      expect(wrapper().style.width).toBe('100%');
      expect(wrapper().getAttribute('data-preview-ratio')).toBe('680/280');
      cleanup();
    }
  });

  it('clamps invalid scale values to a safe viewport', () => {
    mountPreview(0);
    expect(viewportPercent()).toBeGreaterThanOrEqual(100);
    cleanup();
    mountPreview(400);
    expect(scaleFactor()).toBeCloseTo(1, 4);
    expect(viewportPercent()).toBeCloseTo(100, 3);
  });

  it('works for any isolated preview frame', () => {
    render(
      <IsolatedPreviewFrame title="probe" width={400} height={80} scale={65}>
        <p>inside</p>
      </IsolatedPreviewFrame>,
    );
    expect(scaleFactor('probe')).toBeCloseTo(0.65, 4);
    expect(wrapper('probe').style.overflow).toBe('hidden');
  });
});

describe('retired pins do not affect preview zoom', () => {
  it('ignores a legacy showPinEnabled request in the serialized preview query', () => {
    const query = queryFor({ showPinEnabled: true, pinPlatforms: ['twitch'] });
    expect(query).not.toContain('showPinEnabled');
    expect(query).not.toContain('pinPlatforms');
  });

  it('keeps the former pin fixture as ordinary preview content, not a pin banner', () => {
    mountPreview(65, true, { showPinEnabled: true, pinPlatforms: ['twitch'] });
    const text = frameDoc().body.textContent ?? '';
    expect(text).toContain('read the pinned message before asking');
    expect(text).not.toContain(`Pinned by ${SAMPLE_PIN_BY}`);
    expect(text).not.toContain('Pinned Message');
    expect(scaleFactor()).toBeCloseTo(0.65, 4);
  });
});
