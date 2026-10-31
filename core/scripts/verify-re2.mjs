// Verifies the native RE2 binding loads and is linear-time. Exit 1 on failure.
// If this fails: run `npm rebuild re2` (never pass --allow-scripts or add
// unreviewed dependencies), or run this script with --fix to do exactly that.
// --soft (used by `pretest`) never fails the run: it only attempts the rebuild and
// warns, so unrelated tests still run if a rebuild is impossible here.
// The addon is built for one Node ABI at a time (pinned dev Node is .nvmrc, v24);
// a reviewer on another Node major must rebuild under that Node. See opencircuit-forum/proposals/pro-harness-optimization_v2.md.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let RE2;
try {
  RE2 = require("re2");
} catch (e) {
  if (
    (process.argv.includes("--fix") || process.argv.includes("--soft")) &&
    !process.env.RE2_FIX_RETRY
  ) {
    console.error("re2 failed to load; running: npm rebuild re2");
    const r = spawnSync("npm", ["rebuild", "re2"], { stdio: "inherit" });
    if (r.status !== 0) {
      console.error(
        "Rebuild failed. If the error is EPERM/EACCES, node_modules/re2/build is not writable by this user (read-only checkout or sandbox, or files owned by another user). Fix ownership (e.g. chown -R $USER core/node_modules/re2) or run from a writable checkout under the pinned Node (.nvmrc).",
      );
    }
    if (r.status === 0) {
      const again = spawnSync(process.execPath, process.argv.slice(1), {
        stdio: "inherit",
        env: { ...process.env, RE2_FIX_RETRY: "1" },
      });
      process.exit(again.status ?? 1);
    }
  }
  console.error(`FAIL: re2 native binding did not load: ${e.message}`);
  console.error(
    `Active Node ${process.version} (ABI ${process.versions.modules}). Fix: npm rebuild re2 using this same Node.`,
  );
  process.exit(process.argv.includes("--soft") ? 0 : 1);
}

const input = "a".repeat(50_000) + "!";
const start = process.hrtime.bigint();
const matched = new RE2("^(a+)+$").test(input);
const ms = Number(process.hrtime.bigint() - start) / 1e6;
if (matched || ms > 1000) {
  console.error(
    `FAIL: catastrophic pattern not linear (matched=${matched}, ${ms.toFixed(0)}ms)`,
  );
  process.exit(1);
}

let rejected = false;
try {
  new RE2("(?=a)a");
} catch {
  rejected = true;
}
if (!rejected) {
  console.error("FAIL: RE2 accepted a lookahead; expected rejection");
  process.exit(1);
}
console.log(
  `PASS: re2 loaded, linear-time (${ms.toFixed(1)}ms), unsupported syntax rejected`,
);
