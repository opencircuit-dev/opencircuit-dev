import os from "node:os";
import path from "node:path";

export function getTerminalShell(command: string): {
  shell: string;
  args: string[];
} {
  if (process.platform === "win32") {
    return {
      shell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    };
  }
  return { shell: "/bin/sh", args: ["-c", command] };
}

export function getTerminalEnvironment(): NodeJS.ProcessEnv {
  const home = os.userInfo().homedir;
  const env: NodeJS.ProcessEnv = {
    PATH:
      process.platform === "win32"
        ? [
            "C:\\Windows\\System32",
            "C:\\Windows",
            path.dirname(process.execPath),
          ].join(path.delimiter)
        : [
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
            path.dirname(process.execPath),
          ].join(path.delimiter),
    FORCE_COLOR: "1",
    COLORTERM: "truecolor",
    TERM: "xterm-256color",
    CLICOLOR: "1",
    CLICOLOR_FORCE: "1",
  };
  if (process.platform === "win32") {
    env.USERPROFILE = home;
    env.SystemRoot = "C:\\Windows";
    env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
    env.TEMP = path.join(home, "AppData", "Local", "Temp");
    env.TMP = env.TEMP;
  } else {
    env.HOME = home;
  }
  for (const name of ["LANG", "LC_ALL", "LC_CTYPE", "LANGUAGE"]) {
    const value = process.env[name];
    if (value && /^[A-Za-z0-9_.@:-]+$/.test(value)) env[name] = value;
  }
  return env;
}
