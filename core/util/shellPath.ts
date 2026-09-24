import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
export async function getEnvPathFromUserShell(
  remoteName?: string,
): Promise<string | undefined> {
  const isWindowsHostWithWslRemote =
    process.platform === "win32" && remoteName === "wsl";
  if (process.platform === "win32" && !isWindowsHostWithWslRemote) {
    return undefined;
  }

  if (!process.env.SHELL) {
    return undefined;
  }

  try {
    // Source common profile files
    const profileScript =
      'for f in ~/.zprofile ~/.zshrc ~/.bash_profile ~/.bashrc; do [ -f "$f" ] && source "$f" 2>/dev/null; done; echo $PATH';

    const { stdout } = await execFileAsync(
      process.env.SHELL,
      ["-l", "-c", profileScript],
      {
        encoding: "utf8",
      },
    );

    return stdout.trim();
  } catch (error) {
    return process.env.PATH; // Fallback to current PATH
  }
}
