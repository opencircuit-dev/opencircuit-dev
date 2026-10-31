# Open Circuit PR Review Action

`general-review` is a composite GitHub Action that runs an Open Circuit agent
on pull requests and posts its review as a PR comment. The action definition
is [`general-review/action.yml`](general-review/action.yml).

## Example workflow

Pin the action to a reviewed commit and store its API key as a repository or
organization Actions secret:

```yaml
name: Open Circuit PR Review
on:
  pull_request:
    types: [opened, ready_for_review]
  issue_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: opencircuit-dev/opencircuit-dev/actions/general-review@ac4d68177934ba4c338b7081f7859275d3d95351
        with:
          ocircuit-api-key: ${{ secrets.OCIRCUIT_API_KEY }}
          ocircuit-org: your-org-name
          ocircuit-agent: your-org-name/review-bot
```

The action currently installs `@opencircuit/cli@1.5.47`; this runtime version
is managed by the action and is independent of the CLI source version in this
checkout. Confirm compatibility and review the pinned action commit before
adopting it.

## Inputs and authorization

| Input              | Required | Purpose                                                        |
| ------------------ | -------- | -------------------------------------------------------------- |
| `ocircuit-api-key` | Yes      | Open Circuit API key; pass it through a GitHub Actions secret. |
| `ocircuit-org`     | Yes      | Organization used by the Open Circuit configuration.           |
| `ocircuit-agent`   | Yes      | Agent path, for example `your-org/review-bot`.                 |

For pull-request events, drafts are skipped. The action runs only when the
author has write-level repository permission; if that permission lookup fails,
it falls back to GitHub's `OWNER`, `MEMBER`, or `COLLABORATOR` association.
For `issue_comment`, the comment must be on a pull request, contain
`@ocircuit-review`, and come from an authorized user. The workflow needs
`pull-requests: write` and `issues: write` to post and update review comments.

## Behavior and troubleshooting

The action checks authorization, checks out the repository, obtains the PR
diff, builds a review prompt, runs the configured agent, and posts the result.
To request a review manually, comment `@ocircuit-review` on a pull request.

If no review appears, inspect the Actions run for skipped authorization,
missing secrets, invalid organization/agent configuration, or insufficient
workflow permissions. The action does not run for arbitrary issue comments.

See the [repository](https://github.com/opencircuit-dev/opencircuit-dev) for
source and support.
