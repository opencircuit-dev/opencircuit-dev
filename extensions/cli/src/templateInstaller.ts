import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { env } from "./env.js";

export interface TemplateInstallResult {
  installed: string[];
  preserved: string[];
}

function getPackagedTemplateDirectory(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../templates",
  );
}

function getTemplateDirectory(): string {
  return path.join(env.ocircuitHome, "templates");
}

const CISCO_PROFILE_FILE = "cisco-circuit.env";

/**
 * Installs the Cisco profile injected by the protected internal release job,
 * without replacing an existing one. Public builds do not include a profile.
 */
export function installPackagedCiscoProfile(
  sourcePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../profiles",
    CISCO_PROFILE_FILE,
  ),
): "installed" | "preserved" | "unavailable" {
  let profile: Buffer;
  try {
    profile = readFileSync(sourcePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "unavailable";
    }
    throw error;
  }
  const targetPath = path.join(env.ocircuitHome, CISCO_PROFILE_FILE);
  mkdirSync(env.ocircuitHome, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(targetPath, profile, {
      flag: "wx",
      mode: 0o600,
    });
    return "installed";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "preserved";
    throw error;
  }
}

export function installPackagedTemplates(): TemplateInstallResult {
  const sourceDirectory = getPackagedTemplateDirectory();
  const templateDirectory = getTemplateDirectory();
  const configHome = path.dirname(templateDirectory);

  mkdirSync(configHome, { recursive: true, mode: 0o700 });
  chmodSync(configHome, 0o700);
  mkdirSync(templateDirectory, { recursive: true, mode: 0o700 });
  chmodSync(templateDirectory, 0o700);

  const installed: string[] = [];
  const preserved: string[] = [];

  for (const entry of readdirSync(sourceDirectory, {
    withFileTypes: true,
  }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile()) continue;

    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(templateDirectory, entry.name);

    try {
      writeFileSync(targetPath, readFileSync(sourcePath), {
        flag: "wx",
        mode: 0o600,
      });
      installed.push(entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        preserved.push(entry.name);
        continue;
      }
      throw error;
    }
  }

  return { installed, preserved };
}
