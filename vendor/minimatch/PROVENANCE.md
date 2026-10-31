# Maintained minimatch backport

Imported from npm `minimatch@10.2.6`, retaining its BlueOak-1.0.0 license.
Original tarball SHA-256:
`5a3d2c8074a28229665727e47b8a1090941856a7962905efe05d20d3760355f8`.

The ESM and CommonJS `index.js` files backport the preprocessing limits from
upstream commit `77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8`:
https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8

At optimization level 2, stop generated pattern splitting at `braceExpandMax`
(default 100,000) and skip quadratic deduplication above 1,000 patterns.
This fixes GHSA-g3hv-75wg-m249 without removing the `makeRe` API required by
existing ESLint consumers. Other runtime code and declarations are unchanged.
Original source maps are omitted because their mappings predate the patch.
The brace-expansion dependency is pinned to patched version 5.0.12.

This is a local maintained fork, not a claim that upstream 10.2.6 is fixed.
Its scoped name and `10.2.6+oc.1` version must appear in dependency/license
evidence. Replace it when compatible patched upstream parents are available.
