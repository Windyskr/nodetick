import { describe, expect, it } from 'vitest';
import { descriptionPreview, markdownToPlainText } from '../src/lib/markdownText';

describe('markdownToPlainText', () => {
  it.each([
    ['# Heading', 'Heading'],
    ['## Venue ##', 'Venue'],
    ['- [ ] Book **the barn** near the lake', 'Book the barn near the lake'],
    ['- [x] done', 'done'],
    ['1. first', 'first'],
    ['2) second', 'second'],
    ['> quoted *text*', 'quoted text'],
    ['See [the docs](https://example.com/a_(b)) now', 'See the docs now'],
    ['![screenshot](https://x.com/a.png)', 'screenshot'],
    ['<https://x.com>', 'https://x.com'],
    ['`code` and ~~gone~~ and ==marked== and <u>under</u>', 'code and gone and marked and under'],
    ['**注意：**这里', '注意：这里'],
    ['snake_case_name stays', 'snake_case_name stays'],
    ['2*3*4 and a * b', '2*3*4 and a * b'],
    ['escaped \\*stars\\* and \\# hash', 'escaped *stars* and # hash'],
    ['#tag stays', '#tag stays'],
    ['---', ''],
    ['```js', ''],
  ])('%j reads as %j', (markdown, expected) => {
    expect(markdownToPlainText(markdown)).toBe(expected);
  });

  it('keeps the lines', () => {
    expect(markdownToPlainText('# Title\n- a\n- b\r\ntext')).toBe('Title\na\nb\ntext');
  });
});

describe('descriptionPreview', () => {
  it('is the first line with text', () => {
    expect(descriptionPreview('\n\n## Notes\n- one')).toBe('Notes');
    expect(descriptionPreview('```\n```\n\n- [ ] first item')).toBe('first item');
    expect(descriptionPreview('')).toBe('');
  });

  it('is cut at the given length', () => {
    expect(descriptionPreview('a'.repeat(10), 4)).toBe('aaaa…');
  });
});
