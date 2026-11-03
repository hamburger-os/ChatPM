const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'overrides',
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function parsePackageJson(text, revision) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not a JSON object');
    }
    return parsed;
  } catch (error) {
    throw new Error('Unable to parse package.json at ' + revision + ': ' + error.message);
  }
}

export function packageJsonWithoutDependencies(text, revision = 'input') {
  const parsed = parsePackageJson(text, revision);
  const rest = { ...parsed };
  for (const field of dependencyFields) delete rest[field];
  return canonical(rest);
}

export function isDependencyOnlyPackageJsonChange(baseText, headText, baseRevision = 'base', headRevision = 'head') {
  return JSON.stringify(packageJsonWithoutDependencies(baseText, baseRevision)) ===
    JSON.stringify(packageJsonWithoutDependencies(headText, headRevision));
}
