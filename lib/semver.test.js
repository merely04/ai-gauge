import { describe, expect, test } from 'bun:test';
import { compareVersions, isValidSemver, parseVersion } from './semver.js';

describe('isValidSemver', () => {
  const valid = ['0.0.0', '1.2.3', '1.0.0-alpha', '1.0.0-alpha.1', '2.0.0-beta.1', '1.5.0+sha.abc'];
  const invalid = ['', '1', '1.2', 'v1.2.3', '1.0.0-', '1..0.0', 'banana', 'javascript:alert(1)'];

  test.each(valid)('accepts valid %s', (v) => expect(isValidSemver(v)).toBe(true));
  test.each(invalid)('rejects invalid %s', (v) => expect(isValidSemver(v)).toBe(false));
});

describe('parseVersion', () => {
  test('parses plain version', () => {
    expect(parseVersion('1.2.3')).toEqual({ main: [1, 2, 3], prerelease: undefined });
  });

  test('parses prerelease', () => {
    expect(parseVersion('1.0.0-alpha.2')).toEqual({ main: [1, 0, 0], prerelease: ['alpha', '2'] });
  });

  test('strips build metadata', () => {
    expect(parseVersion('1.0.0+sha.abc')).toEqual({ main: [1, 0, 0], prerelease: undefined });
  });

  test('strips build metadata from prerelease', () => {
    expect(parseVersion('1.0.0-alpha+sha.abc')).toEqual({ main: [1, 0, 0], prerelease: ['alpha'] });
  });
});

describe('compareVersions', () => {
  const fixtures = [
    ['1.0.0', '1.0.0', 0],
    ['1.0.0', '1.0.1', -1],
    ['1.0.1', '1.0.0', 1],
    ['1.0.0', '1.1.0', -1],
    ['2.0.0', '1.9.9', 1],
    ['1.0.0-alpha', '1.0.0', -1],
    ['1.0.0-alpha', '1.0.0-beta', -1],
    ['1.0.0-alpha.1', '1.0.0-alpha.2', -1],
    ['1.0.0-alpha.1', '1.0.0-alpha.10', -1],
    ['2.0.0-beta.1', '1.9.9', 1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0+build.1', '1.0.0+build.2', 0],
    ['1.0.0-alpha+sha.1', '1.0.0-alpha+sha.2', 0],
    ['1.0.0-alpha.1', '1.0.0-alpha.beta', -1],
    ['1.0.0-beta.2', '1.0.0-beta.11', -1],
    ['1.0.0-alpha-beta', '1.0.0-alpha-gamma', -1],
    ['1.0.0-rc-1', '1.0.0-rc-2', -1],
  ];

  test.each(fixtures)('%s vs %s => %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });
});
