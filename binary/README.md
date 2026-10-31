# Core binary packaging

This directory contains the older `pkg`-based packaging path for Core and the
native workbench backend. It is separate from the supported `oc` CLI release
pipeline, which builds and packages `extensions/cli`.

The build is implemented in `build.js` and bundles entry points with esbuild.
The resulting executables and bundled assets are platform-dependent: native
modules such as SQLite, LanceDB, and ONNX Runtime must match the target
platform. The package metadata currently declares a Node 18 macOS ARM64 `pkg`
target, while the CLI release supports Node.js `>=24.19.0 <27`; do not treat
this directory as the CLI installer.

## Commands

Install the binary package's dependencies and build from this directory:

```bash
npm ci
npm run build
```

Other package scripts include `npm test`, `npm run rebuild` (esbuild-only),
and `npm run build:darwin-x64`. The full build expects the related Core
dependencies and assets to be present. See `package.json` and `build.js` for
the current target and asset configuration.
