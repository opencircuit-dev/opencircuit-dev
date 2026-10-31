# Maintained dependency packages

These packages close unpatched/incompatible upstream chains without changing
the zero-findings release gate. Each directory records its upstream tarball
SHA-256, license and exact modifications in `PROVENANCE.md`. The scoped names
make maintenance ownership explicit; they are not renamed unmodified vulnerable
packages or spoofed upstream release versions.

The checked-in source is the installed package. Reproduce distributable
packages from that source when inspecting package contents:

```sh
npm pack ./vendor/minimatch ./vendor/deepmerge ./vendor/adf-to-md \
  --pack-destination /tmp --ignore-scripts
```

Source-directory references avoid mutable registry and machine-specific file
paths. Root-relative `$minimatch`/`$deepmerge` overrides reuse direct dependency
specifications. Directory references are required because nested tarball
overrides are not portable in npm 11 or 12.
Glob has an explicit nested override retaining patched upstream minimatch 11.
Standalone Core/CLI installs follow the existing root-first shared-package
installation order so the linked source can resolve its dependencies.

`core/test/dependency-upgrades.test.mjs` covers the security regressions and
consumer behavior.
The unchanged release gates still audit every registry dependency. As npm
cannot assess local fixes itself, their security tests/provenance are mandatory
in addition to an empty audit report.
