import { describe, expect, it } from 'vitest';
import { supportPageEnabled } from '@/lib/supportPage';

describe('support page gate', () => {
  it('is on with GXUFY_SUPPORT_PAGE_ENABLED=1 anywhere', () => {
    expect(supportPageEnabled('1', 'production')).toBe(true);
  });

  it('shows under npm run dev when the variable is not set, never in production', () => {
    expect(supportPageEnabled(undefined, 'development')).toBe(true);
    expect(supportPageEnabled(undefined, 'production')).toBe(false);
    expect(supportPageEnabled(undefined, 'test')).toBe(false);
  });

  it('an explicit value always wins', () => {
    expect(supportPageEnabled('0', 'development')).toBe(false);
    expect(supportPageEnabled('', 'development')).toBe(false);
  });
});
