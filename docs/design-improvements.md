## Environment page design and UX improvements

### Goals
- Improve scannability, reduce cognitive load, and make core actions obvious
- Provide richer session and Git context
- Enable faster workflows with fewer clicks and better defaults

### Recommendations

- **Header/Navigation**
  - Sticky environment header with primary actions: New Session, Git status, Start/Stop container, Settings
  - Breadcrumb: Environments › <environment> (one-click back)
  - Consolidated user/avatar actions in the top-right

- **Environment Information**
  - Convert to compact two-column grid: Status badge, Branch chip, Repo with Copy/Open actions, GitHub state
  - Inline container controls: Start/Stop/Restart with tooltips and confirmation
  - Optional health section (collapsed by default): CPU/RAM, disk usage, uptime
  - Remove "github state" section, include just a link to the Github page for the repository. This can be derived from the repository URL.
  - Environments shouldn't have a 'running' or 'branch' field. These are per-session.

- **Sessions**
  - Toolbar: move List/Grid toggle to the right; persist preference; add Sort (recent activity, name) and Search/Filter (name/branch/status)
  - Grid card
    - Title, status pill (active/inactive/dead), branch chip
    - Last activity time and created date
    - Quick actions: Open, Show Git, Rename, Delete (kebab menu)
    - Optional mini activity sparkline or recent commands preview
  - List row
    - Left: name + branch + status; Right: last activity + quick actions
  - Multi-select for bulk delete
  - Show session type (terminal/agent) via icon; real-time indicator for active sessions

- **Empty state**
  - Stronger guided CTAs:
    - Primary: Create Session
    - Secondary: Create feature-branch session (prefill name)
  - Shortcut hint: "Press S to create a session"

- **Feedback, Loading, Errors**
  - Skeletons for info card and sessions list
  - Toasts for create/delete; undo for delete when feasible
  - Clear destructive confirmations
  - Non-blocking error banners with retry

- **Visual hierarchy & spacing**
  - Softer card borders; emphasize headings and chips
  - Tighter vertical rhythm; group controls near subjects
  - Consistent pill styles for status and branch

- **Keyboard & Accessibility**
  - Shortcuts: Back, New session (S), Search (/)
  - Focus outlines and ARIA labels for all controls
  - High-contrast state colors

- **Responsiveness**
  - Collapse metrics on small screens into a summary row
  - Sessions grid adapts to 1–2 columns; actions collapse into menus

- **Advanced (optional)**
  - Inline branch switcher and create-branch flow
  - "Recent activity" stream (Git + terminal milestones)
  - Session templates (node/python/etc.) with defaults

### Design system alignment
- Use shadcn/ui primitives and Tailwind v4 tokens
- Standardize pill styles and toolbar patterns across pages
