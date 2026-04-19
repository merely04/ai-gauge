const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;

export function isValidSemver(version) {
  return typeof version === 'string' && SEMVER_PATTERN.test(version);
}

export function parseVersion(version) {
  const withoutBuild = version.split('+')[0];
  const hyphenIndex = withoutBuild.indexOf('-');
  const main = hyphenIndex === -1 ? withoutBuild : withoutBuild.slice(0, hyphenIndex);
  const prerelease = hyphenIndex === -1 ? undefined : withoutBuild.slice(hyphenIndex + 1);

  return {
    main: main.split('.').map(Number),
    prerelease: prerelease === undefined ? undefined : prerelease.split('.'),
  };
}

function compareMain(a, b) {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function comparePrereleaseIds(aIds, bIds) {
  const len = Math.max(aIds.length, bIds.length);

  for (let i = 0; i < len; i++) {
    if (i >= aIds.length) return -1;
    if (i >= bIds.length) return 1;

    const aId = aIds[i];
    const bId = bIds[i];
    const aNum = Number(aId);
    const bNum = Number(bId);
    const aIsNum = !Number.isNaN(aNum) && String(aNum) === aId;
    const bIsNum = !Number.isNaN(bNum) && String(bNum) === bId;

    if (aIsNum && bIsNum) {
      if (aNum !== bNum) return aNum > bNum ? 1 : -1;
      continue;
    }

    if (aIsNum && !bIsNum) return -1;
    if (!aIsNum && bIsNum) return 1;
    if (aId < bId) return -1;
    if (aId > bId) return 1;
  }

  return 0;
}

export function compareVersions(a, b) {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);

  const mainCmp = compareMain(parsedA.main, parsedB.main);
  if (mainCmp !== 0) return mainCmp;

  if (parsedA.prerelease === undefined && parsedB.prerelease !== undefined) return 1;
  if (parsedA.prerelease !== undefined && parsedB.prerelease === undefined) return -1;
  if (parsedA.prerelease === undefined && parsedB.prerelease === undefined) return 0;

  return comparePrereleaseIds(parsedA.prerelease, parsedB.prerelease);
}
