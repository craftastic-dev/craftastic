## Modular tmux Automation Architecture

### Goals

- **Automate commands** inside persistent tmux sessions (non-interactive or interactive).
- **Detect status** of in-tmux commands: running, waiting for input, finished with exit code.
- **Harvest output** reliably in real time and post-hoc for parsing and persistence.

This design integrates with the existing orchestrator terminal stack (Docker exec + tmux session per app session) without disrupting the interactive WebSocket terminal.

### Current context (what exists today)

- tmux sessions are managed inside containers and attached through Docker exec:
  - `services/orchestrator/src/services/terminal.ts` ensures/attaches tmux session and wires streams.
  - `services/orchestrator/src/routes/terminal.ts` creates terminal sessions and injects agent bootstrap commands via `tmux send-keys`.
  - `services/orchestrator/src/services/session-cleanup.ts` contains tmux session cleanup helpers.
  - tmux config lives in `services/orchestrator/src/config/tmux.conf`.

This proposal adds a dedicated, programmatic automation layer on top of tmux: each automated run uses its own hidden window/pane, writes a log, emits sentinels, and exposes a typed API to drive flows like “claude setup-token → detect prompt → send token → harvest token from output”.

---

## Module Overview

### New services

- `services/orchestrator/src/services/tmux.ts`
  - A thin helper around tmux primitives via Docker exec.
  - Reusable by both the WebSocket terminal service and the automation service.

- `services/orchestrator/src/services/tmux-automation.ts`
  - High-level automation API to run commands in a dedicated window/pane, manage IO, detect status, and harvest logs.

### Responsibilities

- **Session lifecycle**: ensure a named tmux session exists (use DB-provided `tmux_session_name`).
- **Run orchestration**: create a new window per run, wrap the command to emit start/exit sentinels, and optionally keep an interactive shell alive.
- **Output capture**: pipe pane output to a timestamped log for reliable incremental harvesting (with redaction).
- **Status detection**: determine running/waiting/finished via tmux pane state + exit files + sentinels + prompt detectors.
- **Input injection**: send input or paste buffers safely into the pane.
- **Cleanup/retention**: stop piping, rotate/prune logs, and mark completion.

---

## API (TypeScript)

```ts
// services/orchestrator/src/services/tmux-automation.ts
export type AutomationId = string;

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  interactive?: boolean; // default true
  name?: string;         // window name override
  promptDetectors?: RegExp[]; // optional prompt patterns
  redactors?: RegExp[];       // redact patterns from logs
  timeoutMs?: number;         // 0 = no timeout
}

export interface RunResult {
  id: AutomationId;
  session: string;     // tmux session name
  target: string;      // tmux target string (e.g., session:win.pane)
  paneId: string;      // '#{pane_id}'
  logPath: string;     // /tmp/craftastic/<id>.log inside container
}

export type Status =
  | { state: 'running' }
  | { state: 'waiting-for-input'; prompt?: string }
  | { state: 'finished'; code: number };

export interface HarvestResult {
  cursor: number;  // byte position already read
  lines: string[]; // new lines since cursor
}

export const TmuxAutomation = {
  ensureSession(containerId: string, session: string, cwd?: string): Promise<void>;
  run(containerId: string, session: string, command: string, opts?: RunOptions): Promise<RunResult>;
  sendInput(containerId: string, target: string, text: string, pressEnter?: boolean): Promise<void>;
  status(containerId: string, target: string, id: AutomationId, detectors?: RegExp[]): Promise<Status>;
  harvest(containerId: string, id: AutomationId, cursor?: number): Promise<HarvestResult>;
  stop(containerId: string, target: string, id: AutomationId): Promise<void>;
};
```

---

## tmux Mechanics

### Ensure session

- Validate container is running (reuse `getDocker()` and inspect).
- If tmux session missing: `tmux new-session -d -s <session> [-c <cwd>]`.
- Attach/detach behavior is transparent for automation; we target windows/panes explicitly.

### Create a dedicated window and run wrapper

- For each automation run create a new window, named `auto:<id>`:
  - `tmux new-window -t <session> -n auto:<id> '/bin/bash -lc "<WRAPPER>"'`

- Wrapper script template (sentinels + exit file + optional keep-alive):

```bash
/bin/bash -lc '
  id="{{ID}}";
  mkdir -p /tmp/craftastic && EXIT_FILE="/tmp/craftastic/${id}.exit";
  echo "__CRAFTASTIC_START ${id} $(date +%s)__";
  set -o pipefail;
  {{ENV_EXPORTS}}
  {{USER_COMMAND}};
  ec=$?;
  printf "__CRAFTASTIC_EXIT %s__\n" "$ec";
  printf "%s" "$ec" > "$EXIT_FILE";
  {{KEEP_ALIVE}}
'
```

- `ENV_EXPORTS`: `export KEY=value;` for each entry in `opts.env`.
- `KEEP_ALIVE`: `exec bash -i` when `interactive=true`, otherwise empty.

### Pipe pane output to a log

- Immediately enable `pipe-pane` for the newly created pane:

```bash
tmux pipe-pane -o -t <target> \
  'stdbuf -oL -eL awk "{print strftime(\"%Y-%m-%dT%H:%M:%S%z\"), $0}" \
   | sed -E {{REDACTIONS}} >> /tmp/craftastic/{{ID}}.log'
```

- `REDACTIONS`: a chained set of `-e 's/pattern/****/g'` expressions derived from `opts.redactors`.
- `stop` disables piping: `tmux pipe-pane -t <target>` (no command clears piping).

### Status detection

- Pane/process state:
  - `tmux list-panes -F "#{pane_id} #{pane_dead} #{pane_pid} #{pane_current_command}" -t <target>`
  - If `pane_dead=1` or PID missing: treat as finished and read `/tmp/craftastic/<id>.exit` for code.
  - If exit file absent, parse `__CRAFTASTIC_EXIT <code>__` from the log.

- Waiting for input:
  - If running and latest harvested lines match any `promptDetectors` (e.g., `/paste.*token/i`, `/press .*enter/i`): state `waiting-for-input` with last prompt line.
  - Optional fallback heuristic: if interactive and no new output for N seconds, also report `waiting-for-input`.

### Sending input

- Default: `tmux send-keys -t <target> -- <text> [C-m]`.
- For secrets: `tmux load-buffer -- <text>; tmux paste-buffer -t <target>;` to avoid shell echoing in some tools.

### Harvesting output

- Incremental: keep a byte `cursor`. To fetch new lines:
  - `tail -c +$((cursor+1)) -n +1 /tmp/craftastic/<id>.log` via Docker exec.
  - Return `lines` and the updated `cursor`.
- Snapshot fallback: `tmux capture-pane -p -S -2000 -t <target>` if the log is missing.

### Cleanup & retention

- Rotate/prune `/tmp/craftastic/*.log` and `*.exit` after a configurable retention or once persisted.
- Extend existing orphan cleanup to remove `auto:` windows whose panes are dead and have no active tracking record.

---

## Implementation Plan

### Phase 1: Core helpers

- Add `services/orchestrator/src/services/tmux.ts`:
  - `ensureSession(docker, containerId, session, cwd?)`
  - `newWindow(docker, containerId, session, name, command)`
  - `listPanes(docker, containerId, target)`
  - `pipePane(docker, containerId, target, cmd)` / `clearPipePane(...)`
  - `sendKeys(docker, containerId, target, keys)` / `pasteBuffer(...)`
  - `capturePane(docker, containerId, target, start?)`

Refactor `createTerminalSession` to optionally reuse `ensureSession` (no behavior change for WebSocket terminal).

### Phase 2: Automation service

- Add `services/orchestrator/src/services/tmux-automation.ts` implementing the API above:
  - `run`: ensure session → create `auto:<id>` window with wrapper → enable `pipe-pane` → return `{ id, session, target, paneId, logPath }`.
  - `status`: query pane state, read exit file, parse sentinels if needed, apply prompt detectors.
  - `harvest`: tail log from cursor; apply in-process redaction fallback if needed.
  - `sendInput`: send-keys or paste-buffer.
  - `stop`: clear pipe-pane (do not kill pane unless timeout exceeded).

### Phase 3: Data model and persistence

- Optional new table `automation_runs`:
  - Columns: `id`, `session_id`, `window_name`, `pane_id`, `log_path`, `started_at`, `finished_at`, `exit_code`, `last_cursor`.
  - Used for reliability across restarts, monitoring, and retention policies.

### Phase 4: Claude token setup flow

1) Ensure tmux session for the environment.
2) `run(containerId, session, 'claude setup-token', { interactive: true, cwd, promptDetectors: [/paste.*token/i, /press .*enter/i] })`.
3) Loop: `harvest` and `status` every ~1s.
4) When prompt detected → `sendInput(..., '<token>', true)`.
5) Detect printed token (regex tailored to Claude output) → store securely in `agent_credentials` and scrub logs (`sed -i -E 's/<token>/****/g' ...`).
6) When `finished` with exit code, mark run completed.

This complements the existing behavior in `routes/terminal.ts` that conditionally injects `claude` or `claude setup-token` when a human terminal is opened; automation allows doing the same without a WebSocket client.

---

## Security & Privacy

- Redact sensitive values at the point of persistence via `pipe-pane | sed -E`.
- Prefer paste-buffer over send-keys for secrets.
- After harvesting and storing credentials, scrub tokens in existing logs.
- Avoid logging raw pane output server-side; if logging, only after redaction.

---

## Testing Strategy

- Unit tests (pure):
  - String builders for tmux commands (wrapper, pipe-pane, send-keys).
  - Sentinels and exit-code parsing.
  - Prompt detector logic and redactor application.

- Integration (container):
  - Fake CLI that prompts, waits for input, then prints a token and exits with 0/1.
  - Validate status transitions (running → waiting → running → finished) and `harvest` correctness.
  - Validate redaction and exit-file behavior.

---

## Future Improvements

- Structured logs (JSON lines) for easier post-processing.
- Pluggable extractors per agent/tool (e.g., Claude, GitHub CLIs).
- Policy-driven timeouts and retries per command type.
- Metrics on automation runs: duration, success rate, common prompts.

---

## Fit Check vs Current Code

- Reuses container+tmux model in `services/orchestrator/src/services/terminal.ts` and `routes/terminal.ts`.
- Compatible with existing `tmux send-keys` agent bootstrap path; automation uses its own window so it won't disturb interactive panes.
- Uses standard tmux features (`new-window`, `pipe-pane`, `capture-pane`, `list-panes`), available in our images.
- Orphan session cleanup can be extended to `auto:` windows with dead panes.

This design provides a minimal, reliable, and testable foundation for automated CLI interactions while preserving the interactive terminal experience.


