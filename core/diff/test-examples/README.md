# Diff algorithm test fixtures

Fixtures in this directory describe a before/after pair and its expected
rendered diff:

```text
<CODE BEFORE>
---
<CODE AFTER>
---
<EXPECTED DIFF>
```

The `---` lines delimit the three sections; surrounding whitespace is
trimmed. Expected output is written explicitly rather than compared only with
the underlying `myersDiff` result, so tests can capture the display behavior
the product intends.

When adding a case, run the focused diff test. An empty expected-diff section
causes the test helper to write its computed output into the fixture; review
and edit that output before accepting the test.
