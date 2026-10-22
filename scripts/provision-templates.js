const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Provisioning script to ensure default templates are present in the user's home directory.
 */
async function provisionTemplates() {
  const homeDir = os.homedir();
  const templatesDir = path.join(homeDir, ".ocircuit", "templates");
  const templateSourceDir = path.join(__dirname, "..", "templates");

  const templatesToDeploy = [
    "config-cisco-oauth.yaml",
    "config-cisco-circuit.yaml",
  ];

  try {
    // 1. Ensure the target directory exists
    if (!fs.existsSync(templatesDir)) {
      console.log(`Creating directory: ${templatesDir}`);
      fs.mkdirSync(templatesDir, { recursive: true });
    }

    // 2. Deploy each template
    for (const filename of templatesToDeploy) {
      const sourcePath = path.join(templateSourceDir, filename);
      const targetPath = path.join(templatesDir, filename);

      if (!fs.existsSync(sourcePath)) {
        console.warn(
          `Warning: Source template ${filename} not found at ${sourcePath}`,
        );
        continue;
      }

      if (fs.existsSync(targetPath)) {
        console.log(
          `Template ${filename} already exists at ${targetPath}. Skipping to avoid overwrite.`,
        );
        continue;
      }

      console.log(`Deploying template: ${filename} -> ${targetPath}`);
      fs.copyFileSync(sourcePath, targetPath);
    }

    console.log("Template provisioning completed successfully.");
  } catch (error) {
    console.error("Error during template provisioning:", error);
    process.exit(1);
  }
}

provisionTemplates();
