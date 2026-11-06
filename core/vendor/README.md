# Vendored dependencies

This directory contains third-party source that Open Circuit vendors instead
of installing unchanged. The current vendored dependency is Transformers.js;
the local copy avoids pulling in the unused `sharp` package and its native
dependencies.

Keep upstream-owned documentation and unrelated vendor files unchanged. If a
vendor update is needed, document the upstream version and the narrow local
patch, then validate the build paths that consume the vendored code.
