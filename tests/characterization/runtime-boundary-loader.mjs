import fs from "node:fs";

const reportPath = process.env.PHASE0_RUNTIME_BOUNDARY_REPORT;
const deniedFragments = ["/extensions/vscode/", "/gui/", "/binary/"];
const deniedPackages = ["vscode", "@vscode/", "electron"];
const resolved = [];
const violations = [];

function matchesDeniedPackage(specifier, url) {
  return deniedPackages.some((deniedPackage) => {
    const packageName = deniedPackage.endsWith("/")
      ? deniedPackage.slice(0, -1)
      : deniedPackage;
    return (
      specifier === packageName ||
      specifier.startsWith(`${packageName}/`) ||
      url.includes(`/node_modules/${packageName}/`)
    );
  });
}

function writeReport() {
  if (!reportPath) {
    return;
  }
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        check: "retained-closure-runtime-module-resolution",
        status: violations.length === 0 ? "pass" : "fail",
        deniedFragments,
        deniedPackages,
        resolved,
        violations,
      },
      null,
      2,
    ),
  );
}

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  const entry = {
    parentURL: context.parentURL ?? null,
    specifier,
    url: result.url,
  };
  resolved.push(entry);
  if (
    deniedFragments.some((fragment) => result.url.includes(fragment)) ||
    matchesDeniedPackage(specifier, result.url)
  ) {
    violations.push(entry);
  }
  writeReport();
  return result;
}
