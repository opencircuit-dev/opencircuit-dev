const fs = require("fs");
const path = require("path");

const messages = {
  missing_api_key: `## Code Review Summary

⚠️ AI review skipped: OCIRCUIT_API_KEY not configured.

### Configuration Required
- Please set the OCIRCUIT_API_KEY secret in repository settings
- Verify that the organization and config path are valid
`,
  cli_install_failed: `## Code Review Summary

⚠️ AI review skipped: Open Circuit CLI installation failed.

### Troubleshooting
- Check that npm installation succeeded
- Verify @opencircuit/cli package is available
`,
  empty_output: `## Code Review Summary

⚠️ Open Circuit CLI returned an empty response. Please check the configuration.
`,
  cli_not_found: `## Code Review Summary

⚠️ Open Circuit CLI is not properly installed. Please ensure @opencircuit/cli is installed globally.
`,
  config_error: `## Code Review Summary

⚠️ Open Circuit configuration error. Please verify that the assistant exists in the configured service.
`,
  auth_error: `## Code Review Summary

⚠️ Open Circuit API authentication failed. Please check your OCIRCUIT_API_KEY.
`,
  generic_failure: `## Code Review Summary

⚠️ AI review failed. Please check the Open Circuit API key and configuration.

### Troubleshooting
- Verify the OCIRCUIT_API_KEY secret is set correctly
- Check that the organization and config path are valid
- Ensure the Open Circuit service is accessible
`,
};

function main() {
  const [outputPath, messageKey] = process.argv.slice(2);

  if (!outputPath || !messageKey) {
    console.error("Usage: node writeMarkdown.js <outputPath> <messageKey>");
    process.exit(1);
  }

  const message = messages[messageKey];

  if (!message) {
    console.error(`Unknown message key: ${messageKey}`);
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), outputPath);
  fs.writeFileSync(absolutePath, message, "utf8");
  console.log(`Wrote ${messageKey} message to ${absolutePath}`);
}

main();
