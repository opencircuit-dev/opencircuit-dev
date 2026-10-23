import { mkdtemp, chmod, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadCiscoCircuitProfile } from "./ciscoCircuit.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        import("node:fs/promises").then(({ rm }) =>
          rm(directory, { recursive: true }),
        ),
      ),
  );
});

describe("Cisco Circuit protected profile", () => {
  it("loads only a mode-0600 profile and validates the approved gateway", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ocircuit-cisco-"));
    temporaryDirectories.push(directory);
    const profilePath = path.join(directory, "cisco-circuit.env");
    await writeFile(
      profilePath,
      [
        "OCIRCUIT_CISCO_ISSUER=https://identity.cisco.example/oidc",
        "OCIRCUIT_CISCO_CLIENT_ID=public-client",
        "OCIRCUIT_CISCO_SCOPES=openid offline_access",
        "OCIRCUIT_CISCO_GATEWAY_BASE=https://organon.cisco.com/vscode-plugin",
        "OCIRCUIT_CISCO_MODEL_POLICY_PATH=/api/model-policy",
        "OCIRCUIT_CISCO_MODEL_API_VERSION=2026-01-01",
      ].join("\n"),
      { mode: 0o600 },
    );

    expect(loadCiscoCircuitProfile(profilePath)).toMatchObject({
      clientId: "public-client",
      modelPolicyPath: "/api/model-policy",
    });
  });

  it("rejects a group-readable profile and an unapproved gateway", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ocircuit-cisco-"));
    temporaryDirectories.push(directory);
    const profilePath = path.join(directory, "cisco-circuit.env");
    await writeFile(
      profilePath,
      "OCIRCUIT_CISCO_GATEWAY_BASE=https://attacker.example/vscode-plugin\n",
      { mode: 0o644 },
    );
    await chmod(profilePath, 0o644);

    expect(() => loadCiscoCircuitProfile(profilePath)).toThrow("mode 0600");
  });
});
