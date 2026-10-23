import chalk from "chalk";

import {
  installPackagedCiscoProfile,
  installPackagedTemplates,
} from "../templateInstaller.js";

export async function initTemplatesCommand(): Promise<void> {
  const { installed, preserved } = installPackagedTemplates();
  const ciscoProfile = installPackagedCiscoProfile();
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
  console.log(
    ciscoProfile === "unavailable"
      ? "  Cisco profile: not included in this build"
      : `  Cisco profile: ${ciscoProfile} (cisco-circuit.env)`,
  );
}
