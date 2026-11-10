# File-edit destinations and tool denials

## Bounded argument recovery

Missing required top-level arguments produce feedback containing the missing
field names, received keys, and advertised schema, not argument values. The model
may make at most one correction per tool in the current user turn. A correction
must be a single call to the same tool; it does not replay successful siblings or
relax permissions. Invalid corrections stop tool use for that turn.

A missing Write destination requires one unambiguous path explicitly named by
the user or established by a successful Read. The CLI asks for clarification
rather than guessing. The built-in Read accepts the exact single-field
`file_path` alias by renaming it to `filepath` before normal validation and policy
checks; conflicting keys and other tool aliases are not normalized.

The per-turn guard survives compaction and uses the tool registry advertised
for each provider request. Defaults are 100 tool calls, five identical failures,
two denials per action class, three compactions, and 30 minutes. Hard ceilings
are 500 calls, ten identical failures, five denials per class, ten compactions,
and 120 minutes. The first tool denial still stops the turn immediately.

Optional limits in `~/.ocircuit/turn-guard.json` use the keys `maxCalls`,
`maxIdenticalFailures`, `maxDenialsPerClass`, `maxCompactions`, and
`maxWallClockMs`. Organization policy is read from
`/Library/Application Support/OpenCircuit/turn-guard.json` on macOS or
`/etc/ocircuit/turn-guard.json` elsewhere, subject to ownership, permissions,
size, and JSON checks. Invalid settings are reported and leave limits in force.
The `OC_TURN_MAX_CALLS`, `OC_TURN_MAX_IDENTICAL_FAILURES`,
`OC_TURN_MAX_DENIALS`, `OC_TURN_MAX_COMPACTIONS`, and
`OC_TURN_MAX_WALL_CLOCK_MS` environment variables can only lower effective
limits. `OC_TURN_GUARD` cannot disable enforcement.

## Denials and exact destinations

A security-policy denial reports that the requested command did not execute.
Recognized privilege-escalation commands, including `sudo` in a pipeline, identify
the prohibited operation without echoing command arguments or file contents.
Unknown denial reasons retain generic feedback. This does not relax terminal
policy or allow a denied command through auto mode.

The first tool denial ends the current user turn in interactive and headless
execution. Permissions for a batch are checked before any tool in that batch
starts. A rejection cancels its siblings and produces one terminal result for
each call. A permission-check error also cancels the batch. Already completed
work from earlier batches is not rolled back. Changing call IDs, tools, or
compacting history does not reopen a stopped turn. A new user turn starts with
fresh state and still applies all permissions.

For a direct single-file request such as `now update /exact/path/severity.txt`,
the CLI captures the explicit destination before compaction. Native Write, Edit,
and MultiEdit destinations must resolve lexically to that same path. A successful
Read of another file cannot authorize replacing the explicit destination. A
mismatch cancels the batch before preprocessing or execution; the CLI does not
silently correct it. Normal file security and permission checks still apply.
Quoted paths with spaces and equivalent relative paths are supported.

This recognition is deliberately narrow: a standalone update/edit/modify/patch/
overwrite/write request naming one path, optionally followed by `to` or `with`
and content. General implementation tasks, multi-file prose, and other natural
language forms are not converted into single-file constraints. This is an
additional safeguard for built-in tools, not a general filesystem sandbox or an
MCP authorization boundary.

Direct single-file requests do not advertise Bash, and a stale advertised Bash
call is rejected before execution. The system prompt directs the model toward
Read and Edit/MultiEdit, reserves Write for explicit creation or full replacement,
requires exact destinations, and prohibits privilege-escalation assumptions and
retrying policy denials. Prompt guidance is not proof of live model compliance.

## Separate validation phases

1. Denial feedback: replay the observed `echo ... | sudo tee ...` command shapes
   through the real permission checker without executing the shell. Verify
   recognized feedback and no argument-content disclosure.
2. Denial lifecycle: test first-denial stopping, changed IDs/tools, both execution
   modes, and denied calls at each position in mixed batches.
3. Destinations: use temporary files to verify rejection of misspellings and
   actual successful edits of the exact file under ordinary permissions.
4. Tool selection: test system-message guidance and inspect provider request
   tool lists for direct file requests and broader tasks. A stale advertised
   Bash call must still fail closed.

These tests attribute harness behavior to individual changes. They do not prove
provider-specific behavior, live XRDP use, or qualification through the three-host
pipeline. Those require separate retained runs of the changed source revision.
