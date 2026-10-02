import { globalAgent } from "node:https";
import { getCACertificates } from "node:tls";

export async function setupCa() {
  try {
    // Node 24 provides the platform trust store without third-party CA
    // loaders. This preserves enterprise/system CA support while avoiding
    // the vulnerable mac-ca, win-ca, and system-ca dependency chain.
    const systemCertificates = getCACertificates("system");
    if (systemCertificates.length > 0) {
      globalAgent.options.ca = systemCertificates;
    }
  } catch (e) {
    console.warn("Failed to setup CA: ", e);
  }
}
