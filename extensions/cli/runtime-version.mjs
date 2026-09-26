export const SUPPORTED_NODE_RANGE = ">=24.19.0 <27";

export function isSupportedNodeVersion(version) {
  const [majorText, minorText] = String(version)
    .replace(/^v/, "")
    .split(".");
  const major = Number(majorText);
  const minor = Number(minorText);

  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    return false;
  }

  return (major === 24 && minor >= 19) || (major > 24 && major < 27);
}

export function unsupportedNodeVersionMessage(version) {
  return (
    `Open Circuit CLI requires Node.js ${SUPPORTED_NODE_RANGE}. ` +
    `Detected ${version}. Select a supported version (for example, run 'nvm use 24').`
  );
}

export function assertSupportedNodeRuntime(
  version = process.version,
  report = console.error,
) {
  if (isSupportedNodeVersion(version)) {
    return true;
  }

  report(unsupportedNodeVersionMessage(version));
  return false;
}
