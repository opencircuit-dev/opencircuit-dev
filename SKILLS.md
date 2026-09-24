# Open Circuit agent skills

This repository does not currently publish a product-specific Cisco Agent
Skill. Add a skill only when it documents a concrete, reusable Open Circuit
workflow.

## Skill requirements

- Use lowercase kebab-case skill names.
- State prerequisites, supported versions, and activation triggers.
- Begin operational workflows with read-only discovery.
- Distinguish read-only, local mutation, and remote mutation.
- Include rollback and before/after verification for changes.
- Use placeholders instead of credentials or customer data.
- Do not add speculative commands, empty skills, or unverified endpoints.

## Security

Never commit passwords, API keys, tokens, private keys, certificates, or
customer data. Sensitive workflows must identify exact targets, approvals,
rollback, and verification. Review security-sensitive guidance against the
project's CodeGuard rules before publication.

## Validation

For documentation-only skill changes, run:

```bash
git diff --check
```

For executable helpers, add focused tests and document the supported runtime.
