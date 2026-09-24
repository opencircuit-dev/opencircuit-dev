# Open Circuit CLI Terminal UI spec

This spec is incomplete.

## Stack

The Open Circuit CLI uses Ink as a React TUI library.

## cwd/git display

The lower left corner of the TUI should display

- the current git branch if in a git repo
- also the current owner/repo if enough columns are available to display and it's a gh repo
- if not in git, the cwd
