import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  realpathSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evaluateTerminalCommandSecurity,
  getTerminalEnvironment,
  getTerminalShell,
} from "../src/index.js";

const fixtures: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  fixtures
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("trusted terminal execution", () => {
  it("ignores parent executables, profiles and synthetic secrets", () => {
    vi.stubEnv("SHELL", "/attacker/shell");
    vi.stubEnv("PATH", "/attacker/bin");
    vi.stubEnv("HOME", "/attacker/home");
    vi.stubEnv("BASH_ENV", "/attacker/profile");
    vi.stubEnv("NODE_OPTIONS", "--require=/attacker/module");
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-not-a-real-key");
    const env = getTerminalEnvironment();
    expect(env.PATH).not.toContain("/attacker");
    expect(env.HOME).toBe(os.userInfo().homedir);
    for (const key of [
      "SHELL",
      "BASH_ENV",
      "NODE_OPTIONS",
      "ANTHROPIC_API_KEY",
    ])
      expect(env[key]).toBeUndefined();
    if (process.platform !== "win32")
      expect(getTerminalShell("echo safe")).toEqual({
        shell: "/bin/sh",
        args: ["-c", "echo safe"],
      });
    else expect(getTerminalShell("echo safe").args).toContain("-NoProfile");
  });

  it.each([
    "$UNKNOWN /",
    'echo "$UNKNOWN"',
    'CMD="rm -rf /"; $CMD',
    'sh -c "rm -rf /"',
    'bash -c "rm -rf /"',
    "env rm -rf /",
    "echo / | xargs rm -rf",
    'alias safe="rm -rf /"; safe',
    "function safe() { rm -rf /; }; safe",
    'echo ok\nsh -c "rm -rf /"',
    "echo ok\n$UNKNOWN /",
    '/bin/bash -c "rm -rf /"',
    "echo $(whoami)",
    '> output bash -c "rm -rf /"',
    '2> output bash -c "rm -rf /"',
  ])("denies unresolved or wrapped shell input: %s", (command) => {
    expect(
      evaluateTerminalCommandSecurity("allowedWithoutPermission", command),
    ).toBe("disabled");
  });
  it("never auto-approves an arbitrary executable merely because its basename is safe", () => {
    expect(
      evaluateTerminalCommandSecurity(
        "allowedWithoutPermission",
        "/tmp/untrusted/ls",
      ),
    ).toBe("allowedWithPermission");
    expect(
      evaluateTerminalCommandSecurity(
        "allowedWithoutPermission",
        "./git status",
      ),
    ).toBe("allowedWithPermission");
  });
});

describe.skipIf(process.platform === "win32")("canonical chmod policy", () => {
  function fixture() {
    const parent = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "ocircuit-chmod-")),
    );
    fixtures.push(parent);
    const root = path.join(parent, "workspace");
    mkdirSync(root);
    writeFileSync(path.join(root, "file"), "fixture");
    writeFileSync(path.join(parent, "outside"), "outside");
    symlinkSync(path.join(parent, "outside"), path.join(root, "linked-file"));
    symlinkSync(parent, path.join(root, "linked-dir"));
    return { cwd: root, workspaceRoots: [root] };
  }
  it("requires approval only for supported existing regular workspace files", () => {
    const context = fixture();
    for (const command of [
      "chmod 755 file",
      "chmod u+x file",
      "chmod go-w file",
    ]) {
      expect(
        evaluateTerminalCommandSecurity(
          "allowedWithoutPermission",
          command,
          context,
        ),
        command,
      ).toBe("allowedWithPermission");
    }
  });
  it("denies symlinks, escapes, missing files, recursion, references, system paths and compounds", () => {
    const context = fixture();
    for (const command of [
      "chmod 755 linked-file",
      "chmod 755 linked-dir/outside",
      "chmod 755 ../outside",
      "chmod 755 missing",
      "chmod -R 755 .",
      "chmod --reference=file file",
      "chmod 755 .",
      "chmod 755 /",
      "chmod 755 /etc/passwd",
      "chmod 777 file",
      "chmod 4755 file",
      "chmod a+w file",
      "chmod 755 file && echo ok",
      "cd ..; chmod 755 outside",
      "cd ..\nchmod 755 outside",
      "echo ok; chmod 755 file",
      "chmod 755 *.sh",
    ])
      expect(
        evaluateTerminalCommandSecurity(
          "allowedWithoutPermission",
          command,
          context,
        ),
        command,
      ).toBe("disabled");
    expect(
      evaluateTerminalCommandSecurity(
        "allowedWithoutPermission",
        "chmod 755 file",
      ),
    ).toBe("disabled");
  });
});
