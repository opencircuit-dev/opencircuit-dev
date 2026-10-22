import * as http from "http";
import { execFile } from "child_process";
import * as os from "os";
import type { ConfigJson } from "@opencircuit/config-types";

export class AuthManager {
  private config: ConfigJson;

  constructor(config: ConfigJson) {
    this.config = config;
  }

  /**
   * Triggers the authentication flow.
   * Starts a local server, opens the browser, and waits for the token.
   */
  async authenticate(): Promise<string | null> {
    if (!this.config.auth?.enabled) {
      return null;
    }

    const port = this.config.auth.redirectPort || 50681;
    const providerUrl = this.config.auth.providerUrl;
    const clientId = this.config.auth.clientId;

    if (!providerUrl || !clientId) {
      throw new Error(
        "Missing auth configuration: providerUrl or clientId is required.",
      );
    }

    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || "", `http://localhost:${port}`);
        const code = url.searchParams.get("code");

        if (code) {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end(
            "Authentication successful! You can close this window and return to the app.",
          );
          server.close();
          resolve(code);
        } else {
          res.writeHead(400);
          res.end("Authentication failed: No code provided.");
        }
      });

      server.on("error", (err) => {
        reject(new Error(`Local auth server error: ${err.message}`));
      });

      server.listen(port, "127.0.0.1", () => {
        const authUrl = new URL(providerUrl);
        authUrl.searchParams.set("client_id", clientId);
        authUrl.searchParams.set("redirect_uri", `http://localhost:${port}`);
        this.openBrowser(authUrl.toString());
      });
    });
  }

  private openBrowser(url: string): void {
    const platform = os.platform();
    let command = "";
    let args: string[] = [];

    if (platform === "darwin") {
      command = "open";
      args = [url];
    } else if (platform === "win32") {
      command = "rundll32.exe";
      args = ["url.dll,FileProtocolHandler", url];
    } else {
      command = "xdg-open";
      args = [url];
    }

    execFile(command, args, (err) => {
      if (err) {
        console.error(`Failed to open browser: ${err.message}`);
      }
    });
  }
}
