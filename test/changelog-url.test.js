import { describe, expect, test } from 'bun:test';
import { changelogUrlFor } from '../lib/update-lifecycle.js';

describe('changelogUrlFor', () => {
  test('newer version → compare URL', () => {
    expect(changelogUrlFor('1.2.1', '1.2.2')).toBe('https://github.com/merely04/ai-gauge/compare/v1.2.1...v1.2.2');
  });

  test('equal versions → fallback to release page', () => {
    expect(changelogUrlFor('1.2.1', '1.2.1')).toBe('https://github.com/merely04/ai-gauge/releases/tag/v1.2.1');
  });

  test('null fromVersion → fallback to release page', () => {
    expect(changelogUrlFor(null, '1.2.2')).toBe('https://github.com/merely04/ai-gauge/releases/tag/v1.2.2');
  });

  test('undefined fromVersion → fallback to release page', () => {
    expect(changelogUrlFor(undefined, '1.2.2')).toBe('https://github.com/merely04/ai-gauge/releases/tag/v1.2.2');
  });

  test('major version bump → compare URL', () => {
    expect(changelogUrlFor('1.2.1', '2.0.0')).toBe('https://github.com/merely04/ai-gauge/compare/v1.2.1...v2.0.0');
  });

  test('no mere1y typo in any output', () => {
    const urls = [
      changelogUrlFor('1.2.1', '1.2.2'),
      changelogUrlFor(null, '1.2.2'),
      changelogUrlFor('1.2.1', '1.2.1'),
    ];
    for (const url of urls) {
      expect(url).not.toContain('mere1y');
      expect(url).toContain('merely04');
    }
  });
});
