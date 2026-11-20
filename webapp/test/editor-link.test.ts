import { describe, expect, it } from 'vitest';
import { normalizeHref } from '../src/components/editor/LinkEditor';

describe('normalizeHref (link dialog)', () => {
  it('keeps web, mail and phone links', () => {
    expect(normalizeHref(' https://example.com/a?b=1 ')).toBe('https://example.com/a?b=1');
    expect(normalizeHref('mailto:me@example.com')).toBe('mailto:me@example.com');
    expect(normalizeHref('tel:+8610123')).toBe('tel:+8610123');
  });

  it('adds https:// to a bare address and mailto: to an e-mail address', () => {
    expect(normalizeHref('example.com/docs')).toBe('https://example.com/docs');
    expect(normalizeHref('me@example.com')).toBe('mailto:me@example.com');
  });

  it('refuses scripts and things that are not addresses', () => {
    expect(normalizeHref('javascript:alert(1)')).toBeNull();
    expect(normalizeHref('data:text/html,hi')).toBeNull();
    expect(normalizeHref('not a link')).toBeNull();
    expect(normalizeHref('')).toBeNull();
  });
});
