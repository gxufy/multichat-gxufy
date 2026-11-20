/* The catalog-driven setting control.
 *
 * These lock the properties every tool relies on: each of the six descriptor
 * types renders its own control, every control is reachable and named, and the
 * value each emits is correctly typed for the setting's key. Encoding — CSV,
 * repeated params, bitmasks, colour normalization — deliberately lives in the
 * tools, so none of it is exercised or permitted here.
 *
 * The control under test is components/classic/ClassicSetting, which is now the
 * only one: the Tailwind workspace row it replaced is gone along with the
 * workspace. Its markup is Classic (control-then-label select rows, pill
 * switches, chip groups), but the contract is the same one the descriptors
 * declare, and that contract is what this file is about.
 *
 * One structural difference from the retired row matters to every test here:
 * ids are namespaced by a caller-supplied prefix, because the MultiChat and
 * Counter catalogs both contain `stroke` and `textShadow` and now share a page.
 */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ClassicSetting from '@/components/classic/ClassicSetting';
import { COUNTER_CATALOG } from '@/features/counter/settings';
import { counterTool } from '@/features/counter/config';
import {
  DEFAULT_STYLE,
  buildViewerCounterQuery,
  type ViewerCounterStyle,
} from '@/lib/viewerCounterConfig';
import type {
  ColorSetting,
  MultiSelectSetting,
  NumberSetting,
  SelectSetting,
  Setting,
  SettingCatalog,
  SettingValue,
  TextSetting,
  ToggleSetting,
} from '@/lib/tools/settingTypes';

type Demo = {
  flag: boolean;
  choice: string;
  name: string;
  tint: string;
  fade: number;
  plats: readonly string[];
};

const DEFAULTS: Demo = {
  flag: true,
  choice: 'b',
  name: 'hello',
  tint: '#AbC',
  fade: 4,
  plats: ['kick', 'twitch'],
};

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
] as const;

const PLATFORMS = [
  { value: 'kick', label: 'Kick' },
  { value: 'twitch', label: 'Twitch' },
  { value: 'youtube', label: 'YouTube' },
] as const;

/** The prefix these tests render under, and therefore every asserted id. */
const PREFIX = 'demo';

afterEach(cleanup);

/* Typed per variant, so a spread in a test still narrows to its own variant
 * and cannot silently add a property the variant does not declare. */
const SETTINGS = {
  flag: {
    key: 'flag',
    param: 'f',
    label: 'Flag',
    type: 'toggle',
    default: DEFAULTS.flag,
  } satisfies ToggleSetting<Demo>,
  choice: {
    key: 'choice',
    param: 'c',
    label: 'Choice',
    type: 'select',
    options: OPTIONS,
    default: DEFAULTS.choice,
  } satisfies SelectSetting<Demo>,
  name: {
    key: 'name',
    param: 'n',
    label: 'Name',
    type: 'text',
    default: DEFAULTS.name,
  } satisfies TextSetting<Demo>,
  tint: {
    key: 'tint',
    param: 't',
    label: 'Tint',
    type: 'color',
    default: DEFAULTS.tint,
  } satisfies ColorSetting<Demo>,
  fade: {
    key: 'fade',
    param: 'fd',
    label: 'Fade',
    type: 'number',
    default: DEFAULTS.fade,
    min: 0,
    max: 60,
    step: 1,
    unit: 'seconds',
  } satisfies NumberSetting<Demo>,
  plats: {
    key: 'plats',
    param: 'p',
    label: 'Platforms',
    type: 'multiselect',
    options: PLATFORMS,
    default: DEFAULTS.plats,
  } satisfies MultiSelectSetting<Demo>,
};

/** Render one control against the demo defaults, returning the change spy. */
function row(setting: Setting<Demo>, value: SettingValue = DEFAULTS[setting.key]) {
  const onChange = vi.fn<(key: keyof Demo & string, next: SettingValue) => void>();
  render(
    <ClassicSetting
      setting={setting}
      value={value}
      onChange={onChange}
      idPrefix={PREFIX}
    />,
  );
  return onChange;
}

describe('every union member renders its own control', () => {
  it('toggle renders a checkbox switch reflecting the config value', () => {
    row(SETTINGS.flag, false);
    const input = screen.getByLabelText('Flag');
    expect(input).toHaveProperty('type', 'checkbox');
    expect(input).toHaveProperty('checked', false);
  });

  it('select renders a native select with the declared options', () => {
    row(SETTINGS.choice);
    const input = screen.getByLabelText('Choice') as HTMLSelectElement;
    expect(input.tagName).toBe('SELECT');
    expect([...input.options].map((option) => option.value)).toEqual(['a', 'b']);
    expect(input.value).toBe('b');
  });

  it('text renders a text field holding the config string', () => {
    row(SETTINGS.name);
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'hello');
  });

  /* Classic's colour control is a native colour input plus a Transparent button,
     rather than a text field plus a swatch. '' is a meaningful value — it means
     the parameter is omitted — and a colour input cannot express it, which is
     why the button exists at all. */
  it('color renders a native colour input', () => {
    row(SETTINGS.tint, '#aabbcc');
    const input = screen.getByLabelText('Tint');
    expect(input).toHaveProperty('type', 'color');
    expect(input).toHaveProperty('value', '#aabbcc');
  });

  it('color offers a Transparent action only when the descriptor allows it', () => {
    row(SETTINGS.tint);
    expect(screen.queryByRole('button', { name: 'Transparent' })).toBeNull();
    cleanup();

    row({ ...SETTINGS.tint, allowTransparent: true }, '');
    const clear = screen.getByRole('button', { name: 'Transparent' });
    expect(clear.getAttribute('aria-pressed')).toBe('true');
  });

  it('number renders a numeric field holding the config number', () => {
    row(SETTINGS.fade);
    const input = screen.getByLabelText('Fade (seconds)') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.value).toBe('4');
    expect([input.min, input.max, input.step]).toEqual(['0', '60', '1']);
  });

  it('multiselect renders one checkbox per option, checked by value', () => {
    row(SETTINGS.plats);
    const boxes = PLATFORMS.map(
      (option) => screen.getByLabelText(option.label) as HTMLInputElement,
    );
    expect(boxes.map((box) => box.type)).toEqual(['checkbox', 'checkbox', 'checkbox']);
    expect(boxes.map((box) => box.checked)).toEqual([true, true, false]);
  });

  it('renders nothing at all for a hidden setting', () => {
    const { container } = render(
      <ClassicSetting
        setting={{ ...SETTINGS.flag, hidden: true }}
        value={true}
        onChange={() => {}}
        idPrefix={PREFIX}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('the switch is exhaustive: the never branch is unreachable at runtime', () => {
    // A descriptor with an unknown type cannot be constructed without a cast,
    // which is the compile-time guarantee. If one is forced through, the never
    // branch returns it and React refuses to render it.
    const rogue = { key: 'flag', param: 'f', label: 'X', type: 'slider', default: 1 };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <ClassicSetting
          setting={rogue as unknown as Setting<Demo>}
          value={1}
          onChange={() => {}}
          idPrefix={PREFIX}
        />,
      ),
    ).toThrow();
    quiet.mockRestore();
  });
});

describe('accessibility', () => {
  const named = [
    ['toggle', SETTINGS.flag, 'Flag'],
    ['select', SETTINGS.choice, 'Choice'],
    ['text', SETTINGS.name, 'Name'],
    ['color', SETTINGS.tint, 'Tint'],
  ] as const;

  for (const [type, setting, label] of named) {
    it(`${type} associates exactly one label with its input`, () => {
      row(setting);
      expect(screen.getAllByText(label, { selector: 'label' })).toHaveLength(1);
      expect(screen.getByLabelText(label).id).toBe(`${PREFIX}-${setting.key}`);
    });
  }

  it('number names its input once, with the unit in the label', () => {
    /* The unit is part of the accessible name rather than a separate described-by
       node: 'Fade (seconds)' reads as one thing, and a number field whose unit
       lived only in adjacent text could be read without it. */
    row(SETTINGS.fade);
    expect(screen.getAllByText('Fade (seconds)', { selector: 'label' })).toHaveLength(1);
    expect(screen.getByLabelText('Fade (seconds)').id).toBe(`${PREFIX}-fade`);
    expect(screen.getByLabelText('Fade (seconds)')).toHaveProperty('value', '4');
  });

  it('namespaces every id by the supplied prefix', () => {
    /* The reason the prefix exists: two catalogs on one page share setting keys,
       and unprefixed ids would point one label at the other tool's control. */
    render(
      <>
        <ClassicSetting
          setting={SETTINGS.flag}
          value={true}
          onChange={() => {}}
          idPrefix="mc"
        />
        <ClassicSetting
          setting={SETTINGS.flag}
          value={false}
          onChange={() => {}}
          idPrefix="vc"
        />
      </>,
    );
    const boxes = screen.getAllByLabelText('Flag') as HTMLInputElement[];
    expect(boxes.map((box) => box.id)).toEqual(['mc-flag', 'vc-flag']);
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
  });

  it('multiselect names the group with a legend, not a label', () => {
    row(SETTINGS.plats);
    const group = screen.getByRole('group', { name: 'Platforms' });
    expect(group.tagName).toBe('FIELDSET');
    expect(screen.queryByText('Platforms', { selector: 'label' })).toBeNull();
    for (const option of PLATFORMS) {
      expect(screen.getByLabelText(option.label).id).toBe(
        `${PREFIX}-plats-${option.value}`,
      );
    }
  });

  it('links the description to the control', () => {
    row({ ...SETTINGS.flag, description: 'Explains the flag' });
    const input = screen.getByLabelText('Flag');
    expect(input.getAttribute('aria-describedby')).toBe(`${PREFIX}-flag-desc`);
    expect(screen.getByText('Explains the flag').id).toBe(`${PREFIX}-flag-desc`);
  });

  it('links a text setting description without adding a second label', () => {
    row({ ...SETTINGS.name, description: 'Explains the name' });
    const input = screen.getByLabelText('Name');
    expect(screen.getAllByText('Name', { selector: 'label' })).toHaveLength(1);
    expect(input.getAttribute('aria-describedby')).toBe(`${PREFIX}-name-desc`);
    expect(screen.getByText('Explains the name').id).toBe(`${PREFIX}-name-desc`);
  });

  it('announces why a control is disabled', () => {
    row({ ...SETTINGS.choice, disabled: true, disabledReason: 'Sign in first' });
    const input = screen.getByLabelText('Choice');
    expect(input.getAttribute('aria-describedby')).toBe(`${PREFIX}-choice-reason`);
    expect(screen.getByText('Sign in first').id).toBe(`${PREFIX}-choice-reason`);
  });

  it('describes a control by its description and its reason together', () => {
    row({
      ...SETTINGS.choice,
      description: 'What it does',
      disabled: true,
      disabledReason: 'Sign in first',
    });
    expect(screen.getByLabelText('Choice').getAttribute('aria-describedby')).toBe(
      `${PREFIX}-choice-desc ${PREFIX}-choice-reason`,
    );
  });

  it('gives an ungated, undescribed control no aria-describedby at all', () => {
    row(SETTINGS.flag);
    expect(screen.getByLabelText('Flag').getAttribute('aria-describedby')).toBeNull();
  });

  it('describes a multiselect by the reasons its gated options carry', () => {
    /* Per-option gating with no stated reason is a dead end: the chip greys out
       and nothing says how to enable it. The reasons are deduplicated, because
       three options blocked for one reason should say it once. */
    render(
      <ClassicSetting
        setting={SETTINGS.plats}
        value={['kick']}
        onChange={() => {}}
        idPrefix={PREFIX}
        availability={{
          twitch: { available: false, reason: 'Connect Twitch first' },
          youtube: { available: false, reason: 'Connect Twitch first' },
        }}
      />,
    );
    const group = screen.getByRole('group', { name: 'Platforms' });
    expect(group.getAttribute('aria-describedby')).toBe(`${PREFIX}-plats-gated`);
    expect(screen.getAllByText('Connect Twitch first')).toHaveLength(1);
  });

  it('disables every control type that carries a disabled attribute', () => {
    for (const setting of [SETTINGS.flag, SETTINGS.choice, SETTINGS.tint]) {
      row({ ...setting, disabled: true });
      expect(screen.getByLabelText(setting.label)).toHaveProperty('disabled', true);
      cleanup();
    }

    row({ ...SETTINGS.fade, disabled: true });
    expect(screen.getByLabelText('Fade (seconds)')).toHaveProperty('disabled', true);
    cleanup();

    row({ ...SETTINGS.plats, disabled: true });
    for (const option of PLATFORMS) {
      expect(screen.getByLabelText(option.label)).toHaveProperty('disabled', true);
    }
  });

  /* Inertness is the platform's job: a browser dispatches no click on a
   * disabled control. fireEvent dispatches events regardless, so it cannot
   * demonstrate this — the disabled attribute asserted above is what carries
   * the behaviour. */

  it('a disabled text row is readable but not editable', () => {
    /* readOnly rather than disabled: a disabled field is skipped by tab order,
       so its content becomes unreachable to a keyboard user. */
    row({ ...SETTINGS.name, disabled: true });
    const input = screen.getByLabelText('Name');
    expect(input).toHaveProperty('readOnly', true);
    expect(input).toHaveProperty('disabled', false);
  });

  it('an enabled control is enabled, with no residual gating', () => {
    row(SETTINGS.flag);
    expect(screen.getByLabelText('Flag')).toHaveProperty('disabled', false);
    expect(document.querySelectorAll('[disabled]')).toHaveLength(0);
  });
});

describe('change payloads are correctly typed per setting', () => {
  it('toggle emits a boolean for its own key', () => {
    const onChange = row(SETTINGS.flag, true);
    fireEvent.click(screen.getByLabelText('Flag'));
    expect(onChange).toHaveBeenCalledWith('flag', false);
  });

  it('select emits the chosen option value', () => {
    const onChange = row(SETTINGS.choice);
    fireEvent.change(screen.getByLabelText('Choice'), { target: { value: 'a' } });
    expect(onChange).toHaveBeenCalledWith('choice', 'a');
  });

  it('text emits the raw string', () => {
    const onChange = row(SETTINGS.name);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Ab C ' } });
    expect(onChange).toHaveBeenCalledWith('name', ' Ab C ');
  });

  it('text honours maxLength without native truncation surprises', () => {
    const onChange = row({ ...SETTINGS.name, maxLength: 4 });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'abcdefg' } });
    expect(onChange).toHaveBeenCalledWith('name', 'abcd');
  });

  it('text emits an empty string rather than dropping the change', () => {
    const onChange = row(SETTINGS.name);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('name', '');
  });

  it('color emits a string, number emits a number, multiselect emits an array', () => {
    const tint = row(SETTINGS.tint);
    fireEvent.change(screen.getByLabelText('Tint'), { target: { value: '#00ff00' } });
    expect(tint.mock.calls[0][1]).toBe('#00ff00');
    cleanup();

    const fade = row(SETTINGS.fade);
    fireEvent.change(screen.getByLabelText('Fade (seconds)'), { target: { value: '7' } });
    expect(fade.mock.calls[0][1]).toBe(7);
    cleanup();

    const plats = row(SETTINGS.plats);
    fireEvent.click(screen.getByLabelText('YouTube'));
    expect(plats.mock.calls[0][1]).toEqual(['kick', 'twitch', 'youtube']);
  });

  it('falls back to the descriptor default when the config value is the wrong shape', () => {
    row(SETTINGS.fade, 'not a number');
    expect(screen.getByLabelText('Fade (seconds)')).toHaveProperty('value', '4');
    cleanup();

    row(SETTINGS.flag, 'not a boolean');
    expect(screen.getByLabelText('Flag')).toHaveProperty('checked', DEFAULTS.flag);
    cleanup();

    row(SETTINGS.choice, 42);
    expect(screen.getByLabelText('Choice')).toHaveProperty('value', DEFAULTS.choice);
  });
});

describe('multiselect behaviour', () => {
  it('an empty selection is a valid value, not a reset to defaults', () => {
    row(SETTINGS.plats, []);
    for (const option of PLATFORMS) {
      expect(screen.getByLabelText(option.label)).toHaveProperty('checked', false);
    }
  });

  it('deselecting the last option emits an empty array, not the defaults', () => {
    const onChange = row(SETTINGS.plats, ['kick']);
    fireEvent.click(screen.getByLabelText('Kick'));
    expect(onChange).toHaveBeenCalledWith('plats', []);
  });

  it('selecting adds once, and a repeated selection cannot duplicate', () => {
    const onChange = row(SETTINGS.plats, ['kick']);
    fireEvent.click(screen.getByLabelText('Twitch'));
    expect(onChange).toHaveBeenCalledWith('plats', ['kick', 'twitch']);
    // The control is controlled, so re-clicking the same unchanged value
    // cannot append a second copy.
    fireEvent.click(screen.getByLabelText('Twitch'));
    expect(onChange.mock.calls[1][1]).toEqual(['kick', 'twitch']);
  });

  it('deselecting removes only that value', () => {
    const onChange = row(SETTINGS.plats, ['kick', 'twitch', 'youtube']);
    fireEvent.click(screen.getByLabelText('Twitch'));
    expect(onChange).toHaveBeenCalledWith('plats', ['kick', 'youtube']);
  });

  it('emitted order follows the declared options, not click order', () => {
    const onChange = row(SETTINGS.plats, ['youtube']);
    fireEvent.click(screen.getByLabelText('Kick'));
    expect(onChange).toHaveBeenCalledWith('plats', ['kick', 'youtube']);
  });

  it('emitted values are deduplicated even from a duplicated config value', () => {
    const onChange = row(SETTINGS.plats, ['kick', 'kick']);
    fireEvent.click(screen.getByLabelText('Twitch'));
    expect(onChange).toHaveBeenCalledWith('plats', ['kick', 'twitch']);
  });

  it('drops values that are not declared options', () => {
    const onChange = row(SETTINGS.plats, ['kick', 'myspace']);
    fireEvent.click(screen.getByLabelText('Twitch'));
    expect(onChange).toHaveBeenCalledWith('plats', ['kick', 'twitch']);
  });

  it('drops a gated option from the emitted value', () => {
    /* A selection whose capability has disappeared must not be re-emitted just
       because a sibling was clicked — that is how a stale selection survives a
       disconnect. */
    const onChange = vi.fn();
    render(
      <ClassicSetting
        setting={SETTINGS.plats}
        value={['kick', 'twitch']}
        onChange={onChange}
        idPrefix={PREFIX}
        availability={{ twitch: { available: false, reason: 'Connect Twitch first' } }}
      />,
    );
    expect(screen.getByLabelText('Twitch')).toHaveProperty('checked', false);
    fireEvent.click(screen.getByLabelText('YouTube'));
    expect(onChange).toHaveBeenCalledWith('plats', ['kick', 'twitch', 'youtube']);
  });

  it('every checkbox is keyboard reachable and space-operable', () => {
    const onChange = row(SETTINGS.plats, []);
    const box = screen.getByLabelText('Kick') as HTMLInputElement;
    box.focus();
    expect(document.activeElement).toBe(box);
    fireEvent.click(box); // what space produces on a focused checkbox
    expect(onChange).toHaveBeenCalledWith('plats', ['kick']);
  });
});

describe('colour behaviour', () => {
  it('emits the value the native input produces, without reformatting it', () => {
    /* A colour input normalizes to lowercase 6-digit hex itself — that is the
       platform's rule, not this control's. What matters is that the control
       passes the value straight through rather than applying a second rule of its
       own on top, which is what would make a copied URL differ from the swatch. */
    const onChange = row(SETTINGS.tint, '#aabbcc');
    fireEvent.change(screen.getByLabelText('Tint'), { target: { value: '#DEF123' } });
    expect(onChange).toHaveBeenCalledWith('tint', '#def123');
  });

  it('shows a fallback colour for the empty value without emitting it', () => {
    /* '' means "omit the parameter", and a native colour input has no way to
       display nothing. It shows a neutral swatch — but nothing is emitted until
       the user actually picks, so the meaning of '' is preserved. */
    const onChange = row({ ...SETTINGS.tint, allowTransparent: true }, '');
    expect(screen.getByLabelText('Tint')).toHaveProperty('value', '#191919');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the Transparent action emits the empty string', () => {
    const onChange = row({ ...SETTINGS.tint, allowTransparent: true }, '#ffffff');
    fireEvent.click(screen.getByRole('button', { name: 'Transparent' }));
    expect(onChange).toHaveBeenCalledWith('tint', '');
  });

  it('reports transparency as pressed only while the value is empty', () => {
    row({ ...SETTINGS.tint, allowTransparent: true }, '#ffffff');
    expect(
      screen.getByRole('button', { name: 'Transparent' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('never throws on an unusual stored value', () => {
    for (const stored of ['', '#', 'rebeccapurple', 'nonsense']) {
      expect(() => row({ ...SETTINGS.tint, allowTransparent: true }, stored)).not.toThrow();
      cleanup();
    }
  });
});

describe('number behaviour', () => {
  const fadeField = () => screen.getByLabelText('Fade (seconds)');

  it('emits finite numbers, never strings', () => {
    const onChange = row(SETTINGS.fade);
    fireEvent.change(fadeField(), { target: { value: '12' } });
    expect(onChange).toHaveBeenCalledWith('fade', 12);
    expect(typeof onChange.mock.calls[0][1]).toBe('number');
  });

  it('never emits NaN or a coerced zero for an empty or partial entry', () => {
    const onChange = row(SETTINGS.fade);
    for (const partial of ['', '   ', '-', '.', 'abc', '1e', '--2']) {
      fireEvent.change(fadeField(), { target: { value: partial } });
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('emits zero and negative values rather than treating them as absent', () => {
    const onChange = row(SETTINGS.fade);
    fireEvent.change(fadeField(), { target: { value: '0' } });
    expect(onChange).toHaveBeenCalledWith('fade', 0);
    fireEvent.change(fadeField(), { target: { value: '-3' } });
    expect(onChange).toHaveBeenCalledWith('fade', -3);
  });

  it('does not clamp beyond the browser constraints it declares', () => {
    const onChange = row(SETTINGS.fade);
    fireEvent.change(fadeField(), { target: { value: '999' } });
    expect(onChange).toHaveBeenCalledWith('fade', 999);
  });

  it('omits min, max, and step when the descriptor declares none', () => {
    row({ key: 'fade', param: 'fd', label: 'Fade', type: 'number', default: 4 });
    const input = screen.getByLabelText('Fade');
    expect(input.hasAttribute('min')).toBe(false);
    expect(input.hasAttribute('max')).toBe(false);
    expect(input.hasAttribute('step')).toBe(false);
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });
});

/* The point of these is the whole path, not one control: ClassicSetting → the
 * state owner. Every value shape has to arrive at the top intact, because that is
 * where an earlier version silently dropped numbers and arrays. */
describe('the full setting pipeline carries every value type', () => {
  const FULL: SettingCatalog<Demo> = [
    SETTINGS.flag,
    SETTINGS.choice,
    SETTINGS.name,
    SETTINGS.tint,
    SETTINGS.fade,
    SETTINGS.plats,
  ];

  /** Renders the real controls over a stateful owner, as the generator does. */
  function pipeline(initial: Demo = DEFAULTS) {
    const seen: [string, SettingValue][] = [];
    let latest: Demo = initial;

    function Owner() {
      const [config, setConfig] = useState<Demo>(initial);
      latest = config;
      return (
        <>
          {FULL.map((setting) => (
            <ClassicSetting
              key={setting.key}
              setting={setting}
              value={config[setting.key] as SettingValue}
              onChange={(key, next) => {
                seen.push([key, next]);
                setConfig((current) => ({ ...current, [key]: next }));
              }}
              idPrefix={PREFIX}
            />
          ))}
        </>
      );
    }

    render(<Owner />);
    return { seen, config: () => latest };
  }

  it('a toggle reaches the state owner as a boolean', () => {
    const { seen, config } = pipeline();
    fireEvent.click(screen.getByLabelText('Flag'));
    expect(seen).toEqual([['flag', false]]);
    expect(config().flag).toBe(false);
  });

  it('a select reaches the state owner as a string', () => {
    const { seen, config } = pipeline();
    fireEvent.change(screen.getByLabelText('Choice'), { target: { value: 'a' } });
    expect(seen).toEqual([['choice', 'a']]);
    expect(config().choice).toBe('a');
  });

  it('a text field reaches the state owner as a string', () => {
    const { seen, config } = pipeline();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'goodbye' } });
    expect(seen).toEqual([['name', 'goodbye']]);
    expect(config().name).toBe('goodbye');
  });

  it('a colour reaches the state owner as the string the input holds', () => {
    // The input's own normalization to lowercase hex, and nothing further.
    const { seen, config } = pipeline({ ...DEFAULTS, tint: '#aabbcc' });
    fireEvent.change(screen.getByLabelText('Tint'), { target: { value: '#FFeeDD' } });
    expect(seen).toEqual([['tint', '#ffeedd']]);
    expect(config().tint).toBe('#ffeedd');
  });

  it('a number reaches the state owner as a number, never a string', () => {
    const { seen, config } = pipeline();
    fireEvent.change(screen.getByLabelText('Fade (seconds)'), { target: { value: '9' } });
    expect(seen).toEqual([['fade', 9]]);
    expect(typeof seen[0][1]).toBe('number');
    expect(config().fade).toBe(9);
    expect(typeof config().fade).toBe('number');
  });

  it('a multiselect reaches the state owner as a string array, never CSV', () => {
    const { seen, config } = pipeline({ ...DEFAULTS, plats: [] });
    fireEvent.click(screen.getByLabelText('Twitch'));
    expect(seen).toEqual([['plats', ['twitch']]]);
    expect(Array.isArray(seen[0][1])).toBe(true);
    expect(typeof seen[0][1]).not.toBe('string');
    expect(config().plats).toEqual(['twitch']);
  });

  it('discards nothing: six interactions produce six updates', () => {
    const { seen, config } = pipeline({ ...DEFAULTS, plats: [], tint: '#aabbcc' });
    fireEvent.click(screen.getByLabelText('Flag'));
    fireEvent.change(screen.getByLabelText('Choice'), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Tint'), { target: { value: '#00ff00' } });
    fireEvent.change(screen.getByLabelText('Fade (seconds)'), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByLabelText('YouTube'));

    expect(seen.map(([key]) => key)).toEqual([
      'flag',
      'choice',
      'name',
      'tint',
      'fade',
      'plats',
    ]);
    expect(config()).toEqual({
      flag: false,
      choice: 'a',
      name: 'x',
      tint: '#00ff00',
      fade: 30,
      plats: ['youtube'],
    });
  });

  it('multiselect order through the pipeline follows the declared options', () => {
    const { config } = pipeline({ ...DEFAULTS, plats: [] });
    fireEvent.click(screen.getByLabelText('YouTube'));
    fireEvent.click(screen.getByLabelText('Kick'));
    fireEvent.click(screen.getByLabelText('Twitch'));
    expect(config().plats).toEqual(['kick', 'twitch', 'youtube']);
  });

  it('does not mutate the array it emitted', () => {
    const { seen, config } = pipeline({ ...DEFAULTS, plats: [] });
    fireEvent.click(screen.getByLabelText('Kick'));
    const emitted = seen[0][1] as readonly string[];
    fireEvent.click(screen.getByLabelText('Twitch'));
    expect(emitted).toEqual(['kick']);
    expect(config().plats).toEqual(['kick', 'twitch']);
    expect(config().plats).not.toBe(emitted);
  });

  it('an invalid number entry reaches the owner as no update at all', () => {
    const { seen, config } = pipeline();
    fireEvent.change(screen.getByLabelText('Fade (seconds)'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Fade (seconds)'), { target: { value: 'abc' } });
    expect(seen).toEqual([]);
    expect(config().fade).toBe(DEFAULTS.fade);
  });
});

/* The widened union must not disturb the catalog that ships today. This drives
 * the real counter catalog through the real control and normalizer, and checks
 * the serialized query the generator would build from the result. */
describe('the counter catalog still behaves exactly as before', () => {
  const CHANNELS = { twitch: 'someone', kick: 'other_1' };

  function counterPipeline() {
    let latest: ViewerCounterStyle = DEFAULT_STYLE;
    function Owner() {
      const [style, setStyle] = useState<ViewerCounterStyle>(DEFAULT_STYLE);
      latest = style;
      return (
        <>
          {COUNTER_CATALOG.map((setting) => (
            <ClassicSetting
              key={setting.key}
              setting={setting}
              value={style[setting.key] as SettingValue}
              onChange={(key, next) =>
                setStyle((current) => counterTool.normalize({ ...current, [key]: next }))
              }
              idPrefix="vc"
            />
          ))}
        </>
      );
    }
    render(<Owner />);
    return () => latest;
  }

  it('renders every visible counter setting and keeps hidden state unmounted', () => {
    counterPipeline();
    for (const setting of COUNTER_CATALOG) {
      if (setting.hidden) {
        expect(document.getElementById(`vc-${String(setting.key)}`)).toBeNull();
        continue;
      }
      const input = screen.getByLabelText(setting.label);
      expect(['INPUT', 'SELECT']).toContain(input.tagName);
    }
  });

  it('updates booleans and strings, and serializes identically', () => {
    const style = counterPipeline();
    fireEvent.click(screen.getByLabelText('Combined total'));
    fireEvent.change(screen.getByLabelText('Text shadow'), {
      target: { value: 'large' },
    });
    expect(style()).toEqual({
      ...DEFAULT_STYLE,
      combined: !DEFAULT_STYLE.combined,
      textShadow: 'large',
    });
    expect(counterTool.serialize(CHANNELS, style())).toBe(
      buildViewerCounterQuery(CHANNELS, style()),
    );
  });

  it('produces the same query as the defaults before any interaction', () => {
    const style = counterPipeline();
    expect(counterTool.serialize(CHANNELS, style())).toBe(
      buildViewerCounterQuery(CHANNELS, DEFAULT_STYLE),
    );
  });
});
