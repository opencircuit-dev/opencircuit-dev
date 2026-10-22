export const SUPPORTED_NODE_RANGE = ">=24.19.0 <27";

export function isSupportedNodeVersion(version) {
  const [majorText, minorText] = String(version).replace(/^v/, "").split(".");
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
    `Detected ${version}.\n` +
    `With nvm, install the project baseline and make it the default:\n` +
    `  nvm install 24.19.0 && nvm alias default 24.19.0 && nvm use 24.19.0\n` +
    `If 'oc' is missing after switching, global npm installs are per Node.js version. ` +
    `From the directory containing the release archive, reinstall it with:\n` +
    `  npm install --global ./opencircuit-cli-X.Y.Z.tgz\n` +
    `Replace X.Y.Z with the version in the archive filename, then verify with 'node --version', 'command -v oc', and 'oc --version'.`
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
