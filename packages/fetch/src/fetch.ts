import { RequestOptions } from "@opencircuit/config-types";
import * as followRedirects from "follow-redirects";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { BodyInit, RequestInit, Response } from "node-fetch";
import { isIP } from "node:net";
import { rootCertificates } from "node:tls";
import { getAgentOptions } from "./getAgentOptions.js";
import patchedFetch from "./node-fetch-patch.js";
import { getProxy, shouldBypassProxy } from "./util.js";
import { ResolvedNetworkDestination } from "./ssrfPolicy.js";

const { http, https } = (followRedirects as any).default;

function logRequest(
  method: string,
  url: URL,
  headers: { [key: string]: string },
  body: BodyInit | null | undefined,
  proxy?: string,
  shouldBypass?: boolean,
) {
  console.log("=== FETCH REQUEST ===");
  console.log(`Method: ${method}`);
  console.log(`URL: ${url.toString()}`);

  // Log headers in curl format
  console.log("Headers:");
  for (const [key, value] of Object.entries(headers)) {
    console.log(`  -H '${key}: ${value}'`);
  }

  // Log proxy information
  if (proxy && !shouldBypass) {
    console.log(`Proxy: ${proxy}`);
  }

  // Log body
  if (body) {
    console.log(`Body: ${body}`);
  }

  // Generate equivalent curl command
  let curlCommand = `curl -X ${method}`;
  for (const [key, value] of Object.entries(headers)) {
    curlCommand += ` -H '${key}: ${value}'`;
  }
  if (body) {
    curlCommand += ` -d '${body}'`;
  }
  if (proxy && !shouldBypass) {
    curlCommand += ` --proxy '${proxy}'`;
  }
  curlCommand += ` '${url.toString()}'`;
  console.log(`Equivalent curl: ${curlCommand}`);
  console.log("=====================");
}

async function logResponse(resp: Response) {
  console.log("=== FETCH RESPONSE ===");
  console.log(`Status: ${resp.status} ${resp.statusText}`);
  console.log("Response Headers:");
  resp.headers.forEach((value, key) => {
    console.log(`  ${key}: ${value}`);
  });

  // TODO: For streamed responses, this caused the response to be consumed and the connection would just hang open
  // Clone response to read body without consuming it
  // const respClone = resp.clone();
  // try {
  //   const responseText = await respClone.text();
  //   console.log(`Response Body: ${responseText}`);
  // } catch (e) {
  //   console.log("Could not read response body:", e);
  // }
  console.log("======================");
}

function logError(error: unknown) {
  console.log("=== FETCH ERROR ===");
  console.log(`Error: ${error}`);
  console.log("===================");
}

export async function fetchwithRequestOptions(
  url_: URL | string,
  init?: RequestInit,
  requestOptions?: RequestOptions,
  destination?: ResolvedNetworkDestination,
): Promise<Response> {
  const url = typeof url_ === "string" ? new URL(url_) : url_;
  if (!destination && url.host === "localhost") {
    url.host = "127.0.0.1";
  }

  const agentOptions = destination
    ? {
        ca: [...rootCertificates],
        rejectUnauthorized: true,
        timeout: (requestOptions?.timeout ?? 15) * 1000,
        keepAlive: false,
      }
    : await getAgentOptions(requestOptions);

  // Get proxy from options or environment variables
  const proxy = destination
    ? undefined
    : getProxy(url.protocol, requestOptions);

  // Check if should bypass proxy based on requestOptions or NO_PROXY env var
  const shouldBypass = destination
    ? true
    : shouldBypassProxy(url.hostname, requestOptions);

  if (destination) {
    agentOptions.lookup = (
      hostname: string,
      options: { all?: boolean; family?: number },
      callback: (
        error: NodeJS.ErrnoException | null,
        address: string | Array<{ address: string; family: number }>,
        family?: number,
      ) => void,
    ) => {
      const normalizedHostname =
        hostname.startsWith("[") && hostname.endsWith("]")
          ? hostname.slice(1, -1)
          : hostname;
      if (normalizedHostname !== destination.hostname) {
        callback(
          new Error("Connection hostname differs from validated URL"),
          "",
        );
        return;
      }

      const addresses = destination.addresses.filter(
        ({ family }) => !options.family || family === options.family,
      );
      if (addresses.length === 0) {
        callback(
          new Error("No validated address matches the requested family"),
          "",
        );
        return;
      }

      if (options.all) {
        callback(null, addresses);
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    };
    if (url.protocol === "https:" && isIP(destination.hostname) === 0) {
      agentOptions.servername = destination.hostname;
    }
  }

  // Create agent
  const protocol = url.protocol === "https:" ? https : http;
  const agent =
    proxy && !shouldBypass
      ? protocol === https
        ? new HttpsProxyAgent(proxy, agentOptions)
        : new HttpProxyAgent(proxy, agentOptions)
      : new protocol.Agent(agentOptions);

  let headers: { [key: string]: string } = {};

  // Handle different header formats
  if (init?.headers) {
    const headersSource = init.headers as any;

    // Check if it's a Headers-like object (OpenAI v5 HeadersList, standard Headers)
    if (headersSource && typeof headersSource.forEach === "function") {
      // Use forEach method which works reliably on Headers objects
      headersSource.forEach((value: string, key: string) => {
        headers[key] = value;
      });
    } else if (Array.isArray(headersSource)) {
      // This is an array of [key, value] tuples
      for (const [key, value] of headersSource) {
        headers[key] = value as string;
      }
    } else if (headersSource && typeof headersSource === "object") {
      // This is a plain object
      for (const [key, value] of Object.entries(headersSource)) {
        headers[key] = value as string;
      }
    }
  }

  headers = {
    ...headers,
    ...requestOptions?.headers,
  };

  // Replace localhost with 127.0.0.1
  if (!destination && url.hostname === "localhost") {
    url.hostname = "127.0.0.1";
  }

  // add extra body properties if provided
  let updatedBody: string | undefined = undefined;
  try {
    if (requestOptions?.extraBodyProperties && typeof init?.body === "string") {
      const parsedBody = JSON.parse(init.body);
      updatedBody = JSON.stringify({
        ...parsedBody,
        ...requestOptions.extraBodyProperties,
      });
    }
  } catch (e) {
    console.log("Unable to parse HTTP request body: ", e);
  }

  const finalBody = updatedBody ?? init?.body;
  const method = init?.method || "GET";

  // Verbose logging for debugging - log request details
  if (process.env.VERBOSE_FETCH) {
    logRequest(method, url, headers, finalBody, proxy, shouldBypass);
  }

  // fetch the request with the provided options
  try {
    const resp = await patchedFetch(url, {
      ...init,
      body: finalBody,
      headers: headers,
      agent: agent,
    });

    // Verbose logging for debugging - log response details
    if (process.env.VERBOSE_FETCH) {
      await logResponse(resp);
    }

    if (!resp.ok) {
      const requestId = resp.headers.get("x-request-id");
      if (requestId) {
        console.log(`Request ID: ${requestId}, Status: ${resp.status}`);
      }
    }

    return resp;
  } catch (error) {
    // Verbose logging for errors
    if (process.env.VERBOSE_FETCH) {
      logError(error);
    }

    if (!destination && error instanceof Error && error.name === "AbortError") {
      // Return a Response object that streamResponse etc can handle
      return new Response(null, {
        status: 499, // Client Closed Request
        statusText: "Client Closed Request",
      });
    }
    throw error;
  }
}
