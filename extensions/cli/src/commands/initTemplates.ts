import chalk from "chalk";

import { installPackagedTemplates } from "../templateInstaller.js";

export async function initTemplatesCommand(): Promise<void> {
  const { installed, preserved } = installPackagedTemplates();
  const total = installed.length + preserved.length;

  console.log(
    chalk.green(
      `✓ Open Circuit initialized ${total} packaged template${total === 1 ? "" : "s"}`,
    ),
  );

  if (installed.length > 0) {
    console.log(`  Installed: ${installed.join(", ")}`);
  }
  if (preserved.length > 0) {
    console.log(`  Preserved: ${preserved.join(", ")}`);
  }
}
