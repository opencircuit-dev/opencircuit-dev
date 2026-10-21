export function isForbiddenReleaseFile(file) {
  return (
    file === "templates/config-cisco.yaml" ||
    file === "templates/config-devnet.yaml" ||
    file.split("/").some((part) => {
      const name = part.toLowerCase();
      return (
        ["node_modules", ".npmrc", ".env", "credentials"].includes(name) ||
        name.startsWith(".env.") ||
        name.startsWith("credentials.") ||
        name.endsWith(".pem") ||
        name.endsWith(".key")
      );
    })
  );
}

export function parseCliPackReport(output, expectedPackage) {
  const parsed = JSON.parse(output);
  const reports = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Object.keys(parsed).length === 1 &&
        Object.hasOwn(parsed, expectedPackage.name)
      ? [parsed[expectedPackage.name]]
      : [];
  const report = reports[0];
  if (
    reports.length !== 1 ||
    report?.name !== expectedPackage.name ||
    report?.version !== expectedPackage.version ||
    !Array.isArray(report.files) ||
    report.files.length === 0
  ) {
    throw new Error(
      "npm pack must report exactly one matching CLI package with files",
    );
  }
  for (const entry of report.files) {
    if (
      typeof entry?.path !== "string" ||
      entry.path.includes("\\") ||
      /[\x00-\x1f\x7f]/.test(entry.path) ||
      entry.path
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error("npm pack reported an unsafe package file path");
    }
  }
  return report;
}
