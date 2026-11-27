// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { GENERATOR_MOTION_CSS, MOTION_BASE_CSS } from '@/components/site/motion';

describe('motion styles', () => {
  it('honour reduced motion', () => {
    expect(GENERATOR_MOTION_CSS).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(GENERATOR_MOTION_CSS).toContain(MOTION_BASE_CSS);
    /* Every animation and press effect lives inside the no-preference block. */
    const outside = GENERATOR_MOTION_CSS.replace(MOTION_BASE_CSS, '').split('@media (prefers-reduced-motion: no-preference)')[0];
    expect(outside).not.toMatch(/animation:|:active/);
  });

  it('entrance animations leave no transform behind (dropdowns stay on top)', () => {
    expect(GENERATOR_MOTION_CSS).not.toMatch(/animation:[^;]*\bboth\b/);
    expect(GENERATOR_MOTION_CSS).not.toMatch(/animation:[^;]*\bforwards\b/);
  });
});
