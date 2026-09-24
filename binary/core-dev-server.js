const path = require("path");
process.env.OCIRCUIT_DEVELOPMENT = true;

process.env.OCIRCUIT_GLOBAL_DIR = path.join(
  process.env.PROJECT_DIR,
  "extensions",
  ".ocircuit-debug",
);

require("./out/index.js");
