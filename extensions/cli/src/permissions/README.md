# CLI tool permissions

The CLI applies ordered tool policies with three outcomes:

- `allow`: run the tool without a permission prompt.
- `ask`: request user approval before running the tool.
- `exclude`: remove the tool from the available tool set.

The built-in policy source is `defaultPolicies.ts`. Its identifiers are the
actual tool names (for example `Edit`, `Write`, `Read`, `Search`, and
`Bash`), not generic names such as `writeFile`.

## Default behavior

In interactive TUI mode, the built-in editing tools (`Edit`, `MultiEdit`, and
`Write`) require approval. Listed utility tools such as `Read`, `List`,
`Search`, and `Fetch` are allowed. `Bash` and otherwise unmatched tools use
the `ask` policy.

In headless mode, `Bash` and the catch-all `*` policy are allowed. The
explicit policies earlier in the list still take precedence. `PLAN_MODE_POLICIES`
excludes the editing tools; `AUTO_MODE_POLICIES` allows all tools.

## Implementation

Policies are evaluated in order, with the first matching policy winning.
`types.ts`, `defaultPolicies.ts`, `permissionChecker.ts`, and
`permissionManager.ts` define the policy model, defaults, checks, and
interactive approval flow. Update this guide and the permission tests when
changing a tool name, policy order, or mode behavior.
