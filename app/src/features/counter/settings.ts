/* Viewer Counter control catalog.
 *
 * Defaults and allowed values come from the authoritative counter config.
 * Typography shares common font labels while retaining DejaVu Sans as the
 * counter's independent legacy default.
 */
import {
  ALIGNMENTS,
  COUNTER_FONTS,
  COUNTER_FONT_WEIGHTS,
  COUNTER_TEXT_SIZES,
  COUNTER_TEXT_TRANSFORMS,
  DEFAULT_STYLE,
  STROKES,
  TEXT_SHADOWS,
  type ViewerCounterStyle,
} from '@/lib/viewerCounterConfig';
import {
  FONT_WEIGHT_LABELS,
  OVERLAY_FONT_LABELS,
  TEXT_TRANSFORM_LABELS,
} from '@/lib/overlayFonts';
import {
  optionsFrom,
  titleCase,
  type SettingCatalog,
} from '@/lib/tools/settingTypes';

const COUNTER_FONT_OPTIONS = optionsFrom(
  COUNTER_FONTS,
  (value) => OVERLAY_FONT_LABELS[value] ?? titleCase(value),
);

/** Counter controls, including the hidden custom-family mirror used by the picker. */
export const COUNTER_CATALOG: SettingCatalog<ViewerCounterStyle> = [
  {
    key: 'font',
    param: 'counterFont',
    type: 'select',
    label: 'Font',
    options: COUNTER_FONT_OPTIONS,
    default: DEFAULT_STYLE.font,
  },
  {
    key: 'googleFont',
    param: 'font',
    type: 'text',
    label: 'Google font',
    placeholder: 'Press Start 2P',
    default: '',
    hidden: true,
  },
  {
    key: 'fontWeight',
    param: 'counterFontWeight',
    type: 'select',
    label: 'Style',
    options: optionsFrom(
      COUNTER_FONT_WEIGHTS,
      (value) => FONT_WEIGHT_LABELS[value] ?? value,
    ),
    default: DEFAULT_STYLE.fontWeight,
  },
  {
    key: 'textTransform',
    param: 'counterTextTransform',
    type: 'select',
    label: 'Transform',
    options: optionsFrom(
      COUNTER_TEXT_TRANSFORMS,
      (value) => TEXT_TRANSFORM_LABELS[value] ?? titleCase(value),
    ),
    default: DEFAULT_STYLE.textTransform,
  },
  {
    key: 'fontItalic',
    param: 'counterFontItalic',
    type: 'toggle',
    label: 'Enable Italic',
    default: DEFAULT_STYLE.fontItalic,
  },
  {
    key: 'textSize',
    param: 'counterTextSize',
    type: 'select',
    label: 'Size',
    options: optionsFrom(COUNTER_TEXT_SIZES, titleCase),
    default: DEFAULT_STYLE.textSize,
  },
  {
    key: 'fontColor',
    param: 'counterFontColor',
    type: 'color',
    label: 'Text colour',
    default: DEFAULT_STYLE.fontColor,
  },
  {
    key: 'combined',
    param: 'combined',
    type: 'toggle',
    label: 'Combined total',
    description:
      'One total across every configured platform. Off shows a separate count per platform.',
    default: DEFAULT_STYLE.combined,
  },
  {
    key: 'icons',
    param: 'icons',
    type: 'toggle',
    label: 'Platform icons',
    description: 'Show each platform’s icon beside its count.',
    default: DEFAULT_STYLE.icons,
  },
  {
    key: 'bg',
    param: 'bg',
    type: 'toggle',
    label: 'Pill background',
    description: 'Rounded translucent backdrop behind each count.',
    default: DEFAULT_STYLE.bg,
  },
  {
    key: 'align',
    param: 'align',
    type: 'select',
    label: 'Alignment',
    description: 'Horizontal position inside the browser source.',
    options: optionsFrom(ALIGNMENTS, titleCase),
    default: DEFAULT_STYLE.align,
  },
  {
    key: 'textShadow',
    param: 'textShadow',
    type: 'select',
    label: 'Text shadow',
    options: optionsFrom(TEXT_SHADOWS, titleCase),
    default: DEFAULT_STYLE.textShadow,
  },
  {
    key: 'stroke',
    param: 'stroke',
    type: 'select',
    label: 'Outline',
    options: optionsFrom(STROKES, titleCase),
    default: DEFAULT_STYLE.stroke,
  },
] as const;
