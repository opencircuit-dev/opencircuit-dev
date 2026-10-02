import { globalAgent } from "node:https";
import { getCACertificates } from "node:tls";

import { setupCa } from "./ca.js";

describe("setupCa", () => {
  test("uses Node's native platform trust store", async () => {
    const previousCa = globalAgent.options.ca;

    try {
      await setupCa();

      const systemCertificates = getCACertificates("system");
      if (systemCertificates.length > 0) {
        expect(globalAgent.options.ca).toEqual(systemCertificates);
      }
    } finally {
      globalAgent.options.ca = previousCa;
    }
  });
});
