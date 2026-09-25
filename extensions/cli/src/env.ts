import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import dotenv from "dotenv";

const ocircuitHome =
  process.env.OCIRCUIT_GLOBAL_DIR || path.join(os.homedir(), ".ocircuit");
const globalEnvPath = path.join(ocircuitHome, ".env");

if (fs.existsSync(globalEnvPath)) {
  dotenv.config({ path: globalEnvPath });
}
dotenv.config();

export const env = {
  apiBase: process.env.OCIRCUIT_API_BASE ?? "https://api.ocircuit.dev/",
  ocircuitHome,
};
