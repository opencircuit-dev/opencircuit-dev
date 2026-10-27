import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import type { ToolPolicy } from "./types.js";

export interface TerminalSecurityContext {
  cwd: string;
  workspaceRoots: string[];
}

function contains(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function isSystemPath(target: string): boolean {
  if (
    [
      "/private",
      "/var",
      "/private/var",
      "/home",
      "/Users",
      "/tmp",
      "/private/tmp",
    ].includes(target)
  )
    return true;
  return [
    "/",
    "/etc",
    "/private/etc",
    "/bin",
    "/sbin",
    "/usr",
    "/lib",
    "/lib64",
    "/boot",
    "/dev",
    "/proc",
    "/sys",
    "/System",
    "/Library",
    "/root",
    "/opt",
    "/Applications",
    "/var/log",
    "/var/lib",
    "/var/run",
    "/var/db",
    "/var/root",
    "/private/var/log",
    "/private/var/db",
    "/private/var/root",
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
  ].some((root) =>
    root === "/"
      ? target === path.parse(target).root
      : contains(path.resolve(root), target),
  );
}

export function evaluateChmod(
  args: string[],
  context?: TerminalSecurityContext,
): ToolPolicy {
  if (!context || process.platform === "win32") {
    return "disabled";
  }

  const [mode, ...operands] = args;
  // Only literal non-recursive modes on existing regular workspace files.
  if (
    !mode ||
    !(
      /^[0-7]{3}$/.test(mode) ||
      /^(?:[ugoa]*[+=-][rwx]+)(?:,[ugoa]*[+=-][rwx]+)*$/.test(mode)
    ) ||
    operands.length === 0
  ) {
    return "disabled";
  }
  if (/^[0-7]{3}$/.test(mode)) {
    if ((parseInt(mode, 8) & 0o022) !== 0) return "disabled";
  } else if (
    mode.split(",").some((clause) => {
      const match = /^([ugoa]*)([+=-])([rwx]+)$/.exec(clause)!;
      return (
        match[2] !== "-" &&
        match[3].includes("w") &&
        (match[1] === "" || /[goa]/.test(match[1]))
      );
    })
  ) {
    return "disabled";
  }

  try {
    const cwd = realpathSync(context.cwd);
    const roots = context.workspaceRoots.map((root) => realpathSync(root));
    if (
      roots.length === 0 ||
      roots.some(isSystemPath) ||
      !roots.some((root) => contains(root, cwd))
    ) {
      return "disabled";
    }
    for (const operand of operands) {
      if (
        operand.startsWith("-") ||
        /[*?[\]{}~$`]/.test(operand) ||
        operand.split(/[\\/]/).includes("..")
      )
        return "disabled";
      const target = path.resolve(cwd, operand);
      const root = roots.find((candidate) => contains(candidate, target));
      if (!root || target === root || isSystemPath(target)) return "disabled";

      let current = path.parse(target).root;
      for (const part of target.slice(current.length).split(path.sep)) {
        current = path.join(current, part);
        if (lstatSync(current).isSymbolicLink()) return "disabled";
      }
      const canonical = realpathSync(target);
      const stat = lstatSync(canonical);
      if (
        !contains(root, canonical) ||
        isSystemPath(canonical) ||
        !stat.isFile() ||
        (stat.mode & 0o7000) !== 0
      ) {
        return "disabled";
      }
    }
    return "allowedWithPermission";
  } catch (error) {
    if (error instanceof Error) {
      console.warn("Unable to validate chmod target; command denied.");
    }
    return "disabled";
  }
}
