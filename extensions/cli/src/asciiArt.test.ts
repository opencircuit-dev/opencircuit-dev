import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OCIRCUIT_ASCII_ART, getDisplayableAsciiArt } from "./asciiArt.js";

describe("asciiArt", () => {
  let originalColumns: number | undefined;

  beforeEach(() => {
    originalColumns = process.stdout.columns;
  });

  afterEach(() => {
    if (originalColumns === undefined) {
      delete (process.stdout as any).columns;
    } else {
      process.stdout.columns = originalColumns;
    }
  });

  describe("getDisplayableAsciiArt", () => {
    it("should return full ASCII art when terminal is wide enough", () => {
      // Set process.stdout.columns to simulate wide terminal
      process.stdout.columns = 84;

      const result = getDisplayableAsciiArt();

      expect(result).toBe(OCIRCUIT_ASCII_ART);
      expect(result).toContain("██████╗  ██████╗ ██╗ ██████╗");
      expect(result).toContain("██████╗ ██████╗ ██╗   ██╗");
      expect(result).not.toContain("████████╗██╗███╗");
    });

    it("should return the compact OC mark when terminal is too narrow", () => {
      // Set process.stdout.columns to simulate narrow terminal
      process.stdout.columns = 60;

      const result = getDisplayableAsciiArt();

      expect(result).toContain("██████╗  ██████╗");
      expect(result).toContain("╚═════╝  ╚═════╝");
      expect(result).toContain("v1.0.0");
      expect(result).not.toBe(OCIRCUIT_ASCII_ART);
    });

    it("should return the compact OC mark below the full-banner width", () => {
      process.stdout.columns = 83;

      const result = getDisplayableAsciiArt();

      expect(result).toContain("██████╗  ██████╗");
      expect(result).not.toBe(OCIRCUIT_ASCII_ART);
    });

    it("should return full ASCII art when terminal is exactly at threshold", () => {
      process.stdout.columns = 84;

      const result = getDisplayableAsciiArt();

      expect(result).toBe(OCIRCUIT_ASCII_ART);
    });

    it("should default to full ASCII art when columns is undefined", () => {
      // Set process.stdout.columns to undefined (should default to compact width)
      delete (process.stdout as any).columns;

      const result = getDisplayableAsciiArt();

      expect(result).not.toBe(OCIRCUIT_ASCII_ART);
      expect(result).toContain("██████╗  ██████╗");
    });
  });
});
