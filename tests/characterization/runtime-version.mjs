export const SUPPORTED_NODE_RANGE = ">=24.19.0 <27";
export const MIN_SUPPORTED_NODE_VERSION = "24.19.0";
export const MAX_SUPPORTED_NODE_MAJOR = 27;

function parseNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(left, right) {
  for (const component of ["major", "minor", "patch"]) {
    if (left[component] !== right[component]) {
      return left[component] - right[component];
    }
  }

  return 0;
}

export function isSupportedNodeVersion(
  version,
  minimumVersion = MIN_SUPPORTED_NODE_VERSION,
) {
  const parsedVersion = parseNodeVersion(version);
  const parsedMinimum = parseNodeVersion(minimumVersion);

  if (!parsedVersion || !parsedMinimum) {
    return false;
  }

  return (
    compareVersions(parsedVersion, parsedMinimum) >= 0 &&
    parsedVersion.major < MAX_SUPPORTED_NODE_MAJOR
  );
}
