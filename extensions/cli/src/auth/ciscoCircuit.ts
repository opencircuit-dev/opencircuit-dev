import * as path from "node:path";

import type { AuthOptions } from "@opencircuit/config-types";
import {
  loadCiscoCircuitProfile as loadSharedProfile,
  resolveCiscoCircuitAuth as resolveSharedAuth,
} from "@opencircuit/openai-adapters";

import { env } from "../env.js";

export {
  CISCO_CIRCUIT_PROFILE_ENV,
  CISCO_CIRCUIT_ISSUER,
  CISCO_CIRCUIT_CLIENT_ID,
  CISCO_CIRCUIT_SCOPES,
  CISCO_CIRCUIT_GATEWAY_BASE,
  CISCO_CIRCUIT_POLICY_PATH,
  CISCO_CIRCUIT_API_VERSION,
  CISCO_CIRCUIT_SECRET_REF,
  CiscoCircuitGateway,
  type CiscoCircuitProfile,
  type CiscoCircuitTokenSource,
  type CiscoModelPolicyEntry,
  type CiscoModelPolicy,
  type CiscoCircuitGatewayOptions,
} from "@opencircuit/openai-adapters";

export const CISCO_CIRCUIT_PROFILE_PATH = path.join(
  env.ocircuitHome,
  "cisco-circuit.env",
);

export function loadCiscoCircuitProfile(profilePath?: string) {
  return loadSharedProfile(profilePath, CISCO_CIRCUIT_PROFILE_PATH);
}

export function resolveCiscoCircuitAuth(
  auth: AuthOptions,
  profilePath?: string,
): AuthOptions {
  return resolveSharedAuth(auth, profilePath, CISCO_CIRCUIT_PROFILE_PATH);
}
