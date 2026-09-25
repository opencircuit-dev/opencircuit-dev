import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceDirectory = path.join(scriptDirectory, "..", "templates");
const configHome =
  process.env.OCIRCUIT_GLOBAL_DIR || path.join(os.homedir(), ".ocircuit");
const templateDirectory = path.join(configHome, "templates");

mkdirSync(configHome, { recursive: true, mode: 0o700 });
chmodSync(configHome, 0o700);
mkdirSync(templateDirectory, { recursive: true, mode: 0o700 });
chmodSync(templateDirectory, 0o700);

for (const templateName of readdirSync(sourceDirectory)) {
  const sourcePath = path.join(sourceDirectory, templateName);
  const targetPath = path.join(templateDirectory, templateName);
  try {
    writeFileSync(targetPath, readFileSync(sourcePath), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}
