# Documentation map

Keep documentation close to the surface it describes, while keeping the
repository root useful as the project map.

| Documentation                                                             | Placement                                                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Product installation, first run, provider setup, and common user problems | Root `QUICKSTART.md`                                                   |
| Project overview, retained product scope, and development map             | Root `README.md`                                                       |
| Contribution, review, naming, testing, and large-file policies            | Root `CONTRIBUTING.md`, `TESTING.md`, and `LARGE_FILES.md`             |
| Release history and legal/trust documents                                 | Root `CHANGELOG.md`, `CLA.md`, `SECURITY.md`, and `CODE_OF_CONDUCT.md` |
| CLI behavior and user-facing command reference                            | `extensions/cli/README.md`                                             |
| CLI design decisions and behavior contracts                               | `extensions/cli/spec/`                                                 |
| CLI implementation-specific notes and artifact/release operations         | `extensions/cli/docs/` and `extensions/cli/BUILD.md`                   |
| Core subsystem behavior                                                   | The relevant `core/<subsystem>/README.md` or nearby spec               |
| Package API and release notes                                             | The owning `packages/<package>/README.md` and `CHANGELOG.md`           |
| Test architecture and repository-wide validation                          | Root `TESTING.md`                                                      |

When adding a document, prefer an existing owner directory over a new root
file. Add a root document only when the topic applies across multiple retained
surfaces or is part of the repository's contributor/trust contract. Link every
new root guide from `README.md` or `CONTRIBUTING.md`.

Avoid duplicating the same setup instructions in README, QUICKSTART, and a
package guide. Keep one canonical procedure and link to it from the other
surfaces.
