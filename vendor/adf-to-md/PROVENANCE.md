# Corrected ADF runtime package

Imported the unmodified `index.js` from npm `adf-to-md@1.2.1`.
Original tarball SHA-256:
`7e6fe9f295c9e306d1555aadf32abb63cafa1fda6bc12160f74113694bef3ed0`.

Upstream: https://github.com/julianlam/adf-to-md
Author: Julian Lam <julian@nodebb.org>. The published package declares MIT;
the included MIT text preserves attribution (the upstream tarball has no
standalone license file).

Only packaging changes: remove the accidental `eslint-config-nodebb`
production dependency, which `index.js` does not import or require.
The added declaration exposes `convert()` and its result/warning set, and
`validate()` returning void. Jira callers use `convert()` rather than accessing
a nonexistent validation result. No runtime conversion behavior changes.
Remove this maintained package when upstream
publishes a corrected dependency manifest.
