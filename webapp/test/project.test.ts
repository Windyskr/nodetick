import { describe, expect, it } from 'vitest';
import { tOf, useI18n } from '../src/i18n';
import { INBOX_ID, projectDisplayName } from '../src/lib/project';

describe('system project display names', () => {
  it('localizes the fixed inbox by stable id', () => {
    useI18n.setState({ lang: 'zh' });
    expect(projectDisplayName({ id: INBOX_ID, name: 'Inbox' }, tOf)).toBe('收集箱');

    useI18n.setState({ lang: 'en' });
    expect(projectDisplayName({ id: INBOX_ID, name: 'Inbox' }, tOf)).toBe('Inbox');
  });

  it('does not translate an ordinary project with the same name', () => {
    useI18n.setState({ lang: 'zh' });
    expect(projectDisplayName({ id: 'user-inbox', name: 'Inbox' }, tOf)).toBe('Inbox');
  });
});
