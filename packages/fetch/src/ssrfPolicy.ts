import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export interface ResolvedNetworkDestination {
  hostname: string;
  addresses: Array<{ address: string; family: number }>;
}

const blockedAddresses = new BlockList();
const localAddresses = new BlockList();
const globalIpv6Addresses = new BlockList();

const blockedSubnets: Array<[string, number, "ipv4" | "ipv6"]> = [
  ["0.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.0.2.0", 24, "ipv4"],
  ["192.88.99.0", 24, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["64:ff9b:1::", 48, "ipv6"],
  ["100::", 64, "ipv6"],
  ["2001::", 23, "ipv6"],
  ["2001:db8::", 32, "ipv6"],
  ["2002::", 16, "ipv6"],
  ["3fff::", 20, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
];
for (const [address, prefix, family] of blockedSubnets) {
  blockedAddresses.addSubnet(address, prefix, family);
}

const localSubnets: Array<[string, number, "ipv4" | "ipv6"]> = [
  ["10.0.0.0", 8, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["::1", 128, "ipv6"],
  ["fc00::", 7, "ipv6"],
];
for (const [address, prefix, family] of localSubnets) {
  localAddresses.addSubnet(address, prefix, family);
}

globalIpv6Addresses.addSubnet("2000::", 3, "ipv6");

function isLocalAddress(address: string, family: number): boolean {
  return localAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
}

export function isAllowedDestinationAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) {
    return false;
  }
  if (
    family === 6 &&
    (address.toLowerCase().startsWith("::ffff:") ||
      address.toLowerCase().startsWith("0:0:0:0:0:ffff:"))
  ) {
    return false;
  }

  const addressType = family === 4 ? "ipv4" : "ipv6";
  if (blockedAddresses.check(address, addressType)) {
    return false;
  }

  if (isLocalAddress(address, family)) {
    return false;
  }

  return family === 4 || globalIpv6Addresses.check(address, "ipv6");
}

export function validateResolvedNetworkDestination(
  url: URL,
  addresses: Array<{ address: string; family: number }>,
): ResolvedNetworkDestination {
  validateDestinationUrl(url);

  if (
    addresses.length === 0 ||
    addresses.some(
      ({ address, family }) =>
        isIP(address) !== family || !isAllowedDestinationAddress(address),
    )
  ) {
    throw new Error("URL resolves to a disallowed network destination");
  }

  return {
    hostname: normalizeHostname(url.hostname),
    addresses: [...addresses].sort((a, b) => a.family - b.family),
  };
}

function normalizeHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function validateDestinationUrl(url: URL): void {
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error("URL must use HTTPS without embedded credentials");
  }

  if (url.port.length > 0 && url.port !== "443") {
    throw new Error("URL uses a non-default port not allowed by policy");
  }
}

export async function resolveNetworkDestination(
  url: URL,
  lookupAll: typeof lookup = lookup,
): Promise<ResolvedNetworkDestination> {
  validateDestinationUrl(url);
  const hostname = normalizeHostname(url.hostname);
  const literalFamily = isIP(hostname);
  const addresses =
    literalFamily > 0
      ? [{ address: hostname, family: literalFamily }]
      : await lookupAll(hostname, { all: true, verbatim: true });

  return validateResolvedNetworkDestination(url, addresses);
}
