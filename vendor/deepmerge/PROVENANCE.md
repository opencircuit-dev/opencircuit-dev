# Maintained deepmerge fix

Imported the CommonJS runtime and declarations from npm `deepmerge@4.3.1`,
retaining `license.txt` (MIT).
Original tarball SHA-256:
`4003a0a348276a95543fa969f561f6b5968629acbbb59d66018dd23e7b8f1d5c`.

GHSA-gcqx-w48m-w2h4 has no patched upstream release:
https://github.com/advisories/GHSA-gcqx-w48m-w2h4

The runtime explicitly rejects `__proto__`, `constructor` and `prototype` keys.
It checks keys copied from the target as well as keys merged from the source,
including recursively cloned objects/arrays. This closes both entry paths to
prototype poisoning while preserving normal merging, symbols and custom array
merge behavior. Prototype-management keys are intentionally not data keys.

This is a local maintained fork, not a claim that upstream 4.3.1 is fixed.
Its scoped name and `4.3.1+oc.1` version must appear in dependency evidence.
Replace it when an upstream fix can be qualified.
