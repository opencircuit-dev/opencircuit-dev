import { describe, expect, test } from "@jest/globals";

import { JiraClient } from "./JiraClient";

const client = new JiraClient({
  domain: "example.invalid",
  username: "",
  password: "",
});

const document = {
  type: "doc",
  version: 1,
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Issue details" }] },
  ],
};

function fetchIssue(description: object | string, body: object | string) {
  return async () =>
    Response.json({
      key: "TEST-1",
      fields: {
        summary: "Example",
        description,
        comment: {
          comments: [
            {
              body,
              author: { displayName: "Example" },
              created: "2026-10-31",
              updated: "2026-10-31",
            },
          ],
        },
      },
    });
}

describe("Jira document conversion", () => {
  test("converts ADF descriptions and comments to Markdown", async () => {
    const issue = await client.issue("TEST-1", fetchIssue(document, document));
    expect(issue.description).toBe("Issue details");
    expect(issue.comments[0].body).toBe("Issue details");
  });

  test("preserves string descriptions and comments", async () => {
    const issue = await client.issue(
      "TEST-1",
      fetchIssue("Details", "Comment"),
    );
    expect(issue.description).toBe("Details");
    expect(issue.comments[0].body).toBe("Comment");
  });

  test("surfaces malformed ADF instead of returning empty content", async () => {
    await expect(
      client.issue(
        "TEST-1",
        fetchIssue({ type: "doc", version: 2 }, "Comment"),
      ),
    ).rejects.toThrow("adf-validation-failed");
  });
});
