import * as fs from "node:fs";
import * as path from "node:path";

import {
  FQSN,
  PlatformClient,
  SecretResult,
  SecretType,
} from "@opencircuit/config-yaml";
import { OpenCircuitClient } from "@opencircuit/sdk";
import * as dotenv from "dotenv";

import { env } from "./env.js";

export class CLIPlatformClient implements PlatformClient {
  constructor(
    private orgScopeId: string | null,
    private readonly apiClient: OpenCircuitClient,
  ) {}

  private hasRemoteCredentials(): boolean {
    return this.apiClient.isAuthenticated;
  }

  private findSecretInEnvFile(
    filePath: string,
    secretName: string,
  ): string | undefined {
    try {
      if (!fs.existsSync(filePath)) return undefined;

      const envContent = fs.readFileSync(filePath, "utf8");
      const env = dotenv.parse(envContent);
      return env[secretName];
    } catch (error) {
      console.warn(
        `Error reading .env file at ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  private findSecretInProcessEnv(fqsn: FQSN): SecretResult | undefined {
    const secretValue = process.env[fqsn.secretName];
    if (secretValue) {
      return {
        found: true,
        fqsn,
        value: secretValue,
        secretLocation: {
          secretName: fqsn.secretName,
          secretType: SecretType.LocalEnv,
        },
      };
    }
    return undefined;
  }

  private findSecretInLocalEnvFiles(fqsn: FQSN): SecretResult | undefined {
    // The global application file is authoritative for CLI secrets. This
    // avoids silently using a stale shell export when the user has refreshed
    // the value in ~/.ocircuit/.env.
    const workspaceDir = process.cwd();
    const globalEnvPath = path.join(env.ocircuitHome, ".env");

    const globalSecret = this.findSecretInEnvFile(
      globalEnvPath,
      fqsn.secretName,
    );
    if (globalSecret) {
      return {
        found: true,
        fqsn,
        value: globalSecret,
        secretLocation: {
          secretName: fqsn.secretName,
          secretType: SecretType.LocalEnv,
        },
      };
    }

    // Preserve explicit process environment precedence over workspace files.
    const processEnvSecret = this.findSecretInProcessEnv(fqsn);
    if (processEnvSecret) {
      return processEnvSecret;
    }

    for (const envPath of [
      path.join(workspaceDir, ".ocircuit", ".env"),
      path.join(workspaceDir, ".env"),
    ]) {
      const secretValue = this.findSecretInEnvFile(envPath, fqsn.secretName);
      if (secretValue) {
        return {
          found: true,
          fqsn,
          value: secretValue,
          secretLocation: {
            secretName: fqsn.secretName,
            secretType: SecretType.LocalEnv,
          },
        };
      }
    }

    // Fall back to the inherited environment when no application-scoped file
    // contains the requested secret.
    return this.findSecretInProcessEnv(fqsn);
  }

  async resolveFQSNs(fqsns: FQSN[]): Promise<(SecretResult | undefined)[]> {
    if (fqsns.length === 0) {
      return [];
    }

    const results: (SecretResult | undefined)[] = new Array(fqsns.length).fill(
      undefined,
    );

    // First, check local env files for secrets (highest priority for CLI)
    // This allows users to override any secret with a local environment variable
    for (let i = 0; i < fqsns.length; i++) {
      const secretFromEnv = this.findSecretInLocalEnvFiles(fqsns[i]);
      if (secretFromEnv?.found) {
        results[i] = secretFromEnv;
      }
    }

    // For secrets not found locally, try to resolve through the API only when
    // the client is authenticated. Local CLI config should remain completely
    // offline when the hosted resolver is unavailable or disabled.
    const unresolvedIndices = results
      .map((r, i) => (r === undefined ? i : -1))
      .filter((i) => i !== -1);

    if (unresolvedIndices.length > 0 && this.hasRemoteCredentials()) {
      try {
        const unresolvedFqsns = unresolvedIndices.map((i) => fqsns[i]);
        const apiResults: any = await this.apiClient.syncSecrets({
          syncSecretsRequest: {
            fqsns: unresolvedFqsns,
            orgScopeId: this.orgScopeId,
          },
        });

        // Merge API results - keep all found results (with or without value)
        for (let j = 0; j < apiResults.length; j++) {
          if (apiResults[j]?.found) {
            results[unresolvedIndices[j]] = apiResults[j];
          }
        }
      } catch (error) {
        console.warn(
          `Error resolving FQSNs through API: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return results;
  }
}
