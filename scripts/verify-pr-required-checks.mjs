import { pathToFileURL } from "node:url";

const validResults = new Set(["success", "failure", "cancelled", "skipped"]);

function addResultFailure(failures, name, result, required) {
  if (!validResults.has(result)) {
    failures.push(`${name}: missing or invalid result (${result ?? "unset"})`);
    return;
  }

  if (required && result !== "success") {
    failures.push(`${name}: expected success, got ${result}`);
    return;
  }

  if (!required && result !== "success" && result !== "skipped") {
    failures.push(
      `${name}: expected success or conditionally skipped, got ${result}`,
    );
  }
}

export function verifyRequiredChecks(
  workflow,
  profile,
  sameRepository,
  results,
) {
  const failures = [];
  if (profile !== "true" && profile !== "false") {
    return ["cli_core: expected true or false"];
  }

  const alwaysRequired =
    workflow === "core"
      ? ["changes", "prettier-check", "get-packages-matrix"]
      : workflow === "cli"
        ? ["changes"]
        : [];
  if (alwaysRequired.length === 0) {
    return [`workflow: unsupported workflow (${workflow})`];
  }

  for (const name of alwaysRequired) {
    addResultFailure(failures, name, results[name], true);
  }

  if (workflow === "core") {
    for (const name of ["core-checks", "binary-checks", "packages-checks"]) {
      addResultFailure(failures, name, results[name], profile === "true");
    }
  } else {
    for (const name of ["lint", "test", "runtime-guard"]) {
      addResultFailure(failures, name, results[name], profile === "true");
    }
    addResultFailure(
      failures,
      "smoke-api",
      results["smoke-api"],
      profile === "true" && sameRepository === "true",
    );
  }

  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const workflow = process.env.CHECK_WORKFLOW;
  const resultNames =
    workflow === "core"
      ? [
          "changes",
          "prettier-check",
          "get-packages-matrix",
          "core-checks",
          "binary-checks",
          "packages-checks",
        ]
      : ["changes", "lint", "test", "runtime-guard", "smoke-api"];
  const results = Object.fromEntries(
    resultNames.map((name) => [
      name,
      process.env[`RESULT_${name.toUpperCase().replaceAll("-", "_")}`],
    ]),
  );
  const failures = verifyRequiredChecks(
    workflow,
    process.env.CLI_CORE,
    process.env.SAME_REPOSITORY,
    results,
  );

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("All required PR checks passed.");
  }
}
