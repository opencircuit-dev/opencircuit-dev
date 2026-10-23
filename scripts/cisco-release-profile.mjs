// Release-time handling for the protected Cisco Circuit profile. Profile values
// are supplied by the protected release environment and never live in Git.
import {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";

export const PACKAGED_PROFILE_PATH = "profiles/cisco-circuit.env";
export const PROFILE_CONTENT_ENV = "OCIRCUIT_RELEASE_CISCO_PROFILE";
export const PROFILE_FILE_ENV = "OCIRCUIT_RELEASE_CISCO_PROFILE_FILE";

// Must stay aligned with the runtime checks in extensions/cli/src/auth/ciscoCircuit.ts.
const APPROVED_ISSUER_ORIGIN = "https://login.microsoftonline.com";
const APPROVED_GATEWAY_BASE = "https://organon.cisco.com/vscode-plugin";
const MAX_PROFILE_BYTES = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_ORDER = [
  "OCIRCUIT_CISCO_ISSUER",
  "OCIRCUIT_CISCO_CLIENT_ID",
  "OCIRCUIT_CISCO_SCOPES",
  "OCIRCUIT_CISCO_GATEWAY_BASE",
  "OCIRCUIT_CISCO_MODEL_POLICY_PATH",
  "OCIRCUIT_CISCO_MODEL_API_VERSION",
  "OCIRCUIT_CISCO_SECRET_REF",
];
const REQUIRED_KEYS = new Set(KEY_ORDER.slice(0, 4).concat(KEY_ORDER[5]));
const PROFILE_ASSIGNMENT = /^[ \t]*OCIRCUIT_CISCO_[A-Z_]+[ \t]*=[ \t]*\S/m;

/** Reads profile text from exactly one protected release input. */
export function readReleaseProfileSource(env = process.env) {
  const content = env[PROFILE_CONTENT_ENV];
  const file = env[PROFILE_FILE_ENV];
  if (Boolean(content) === Boolean(file)) {
    throw new Error(
      `Provide exactly one of ${PROFILE_CONTENT_ENV} or ${PROFILE_FILE_ENV}`,
    );
  }
  if (content) return content;

  const metadata = lstatSync(file);
  if (!metadata.isFile()) {
    throw new Error("Cisco release profile must be a regular file");
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("Cisco release profile must have mode 0600");
  }
  if (
    typeof process.getuid === "function" &&
    metadata.uid !== process.getuid()
  ) {
    throw new Error("Cisco release profile must be owned by the release user");
  }
  if (metadata.size > MAX_PROFILE_BYTES) {
    throw new Error("Cisco release profile is too large");
  }
  return readFileSync(file, "utf8");
}

/** Validates profile text and returns its canonical dotenv form. */
export function validateReleaseProfile(text) {
  if (Buffer.byteLength(text, "utf8") > MAX_PROFILE_BYTES) {
    throw new Error("Cisco release profile is too large");
  }
  const values = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (!match) throw new Error("Cisco release profile has an invalid line");
    const [, key, value] = match;
    if (!KEY_ORDER.includes(key)) {
      throw new Error(`Cisco release profile has an unknown key: ${key}`);
    }
    if (values.has(key)) {
      throw new Error(`Cisco release profile repeats ${key}`);
    }
    if (
      !value ||
      value !== value.trim() ||
      /["'`$\\#\x00-\x1f\x7f]/.test(value)
    ) {
      throw new Error(`Cisco release profile has an invalid value for ${key}`);
    }
    values.set(key, value);
  }
  for (const key of REQUIRED_KEYS) {
    if (!values.has(key)) {
      throw new Error(`Cisco release profile is missing ${key}`);
    }
  }

  const issuer = new URL(values.get("OCIRCUIT_CISCO_ISSUER"));
  const tenant = issuer.pathname.split("/")[1] ?? "";
  if (
    issuer.origin !== APPROVED_ISSUER_ORIGIN ||
    issuer.pathname !== `/${tenant}/v2.0` ||
    !UUID.test(tenant) ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash
  ) {
    throw new Error(
      "Cisco release profile issuer is not an approved Entra issuer",
    );
  }
  if (!UUID.test(values.get("OCIRCUIT_CISCO_CLIENT_ID"))) {
    throw new Error("Cisco release profile client ID must be a UUID");
  }
  const scopes = values.get("OCIRCUIT_CISCO_SCOPES").split(" ");
  if (
    !scopes.includes("openid") ||
    scopes.some((scope) => !scope || scope.length > 128)
  ) {
    throw new Error("Cisco release profile scopes are invalid");
  }
  if (
    values.get("OCIRCUIT_CISCO_GATEWAY_BASE").replace(/\/$/, "") !==
    APPROVED_GATEWAY_BASE
  ) {
    throw new Error("Cisco release profile gateway is not the approved route");
  }
  const policyPath = values.get("OCIRCUIT_CISCO_MODEL_POLICY_PATH");
  if (policyPath && !/^\/[A-Za-z0-9._~/-]*$/.test(policyPath)) {
    throw new Error("Cisco release profile model policy path is invalid");
  }
  if (
    !/^\d{4}-\d{2}-\d{2}(-preview)?$/.test(
      values.get("OCIRCUIT_CISCO_MODEL_API_VERSION"),
    )
  ) {
    throw new Error("Cisco release profile model API version is invalid");
  }
  const secretRef = values.get("OCIRCUIT_CISCO_SECRET_REF");
  if (secretRef && !/^[A-Za-z0-9._:/-]{1,256}$/.test(secretRef)) {
    throw new Error("Cisco release profile secret reference is invalid");
  }

  const lines = KEY_ORDER.filter((key) => values.has(key)).map(
    (key) => `${key}=${values.get(key)}`,
  );
  return `# Generated by the protected internal release job.\n${lines.join("\n")}\n`;
}

/** True when a packaged file path or its content carries Cisco profile data. */
export function containsCiscoProfileData(file, content = "") {
  const name = file.split("/").at(-1)?.toLowerCase() ?? "";
  return (
    file === PACKAGED_PROFILE_PATH ||
    file.startsWith("profiles/") ||
    name === "cisco-circuit.env" ||
    PROFILE_ASSIGNMENT.test(content)
  );
}

/** Best-effort overwrite before unlinking a temporary profile. */
export function secureDelete(file) {
  let descriptor;
  try {
    descriptor = openSync(file, "r+");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  try {
    const { size } = fstatSync(descriptor);
    if (size > 0) writeSync(descriptor, Buffer.alloc(size), 0, size, 0);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  rmSync(file, { force: true });
}
