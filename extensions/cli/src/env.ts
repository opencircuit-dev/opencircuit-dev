import * as os from "os";
import * as path from "path";

import dotenv from "dotenv";

dotenv.config();

export const env = {
  apiBase: process.env.OCIRCUIT_API_BASE ?? "https://api.ocircuit.dev/",
  ocircuitHome:
    process.env.OCIRCUIT_GLOBAL_DIR || path.join(os.homedir(), ".ocircuit"),
};
