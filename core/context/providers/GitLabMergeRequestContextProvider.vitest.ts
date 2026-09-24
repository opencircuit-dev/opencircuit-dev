import { describe, expect, it } from "vitest";

import { getGitShowArgs } from "./GitLabMergeRequestContextProvider";

const position = (overrides: Record<string, string>) =>
  ({
    head_sha: "0123456789abcdef0123456789abcdef01234567",
    new_path: "src/example.ts",
    ...overrides,
  }) as Parameters<typeof getGitShowArgs>[0];

describe("getGitShowArgs", () => {
  it("preserves valid Git paths as separate git arguments", () => {
    expect(
      getGitShowArgs(position({ new_path: "src/file with spaces.ts" })),
    ).toEqual([
      "show",
      "0123456789abcdef0123456789abcdef01234567:src/file with spaces.ts",
    ]);
  });

  it.each([
    ["invalid SHA", { head_sha: "HEAD; touch /tmp/pwned" }],
    ["absolute path", { new_path: "/etc/passwd" }],
    ["parent path", { new_path: "src/../../etc/passwd" }],
    ["control character", { new_path: "src/file\n.ts" }],
  ])("rejects %s", (_, overrides) => {
    expect(getGitShowArgs(position(overrides))).toBeNull();
  });
});
