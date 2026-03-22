# Marketplace View Design

## Purpose

The Marketplace view (`agentSkills.marketplace`) lets users browse skills available from configured GitHub repositories, search them by name or description, view their details, and install them into the local workspace or user home directory.

---

## Tree Structure

Skills are grouped by their source repository and displayed in a two-level collapsible tree:

```
anthropics/skills                 ← SourceTreeItem (github icon, starts collapsed)
├── code-review                   ← SkillTreeItem (extensions or check icon)
└── test-generator
github/awesome-copilot
└── pr-summary
broken-owner/missing-repo          ← FailedSourceTreeItem (warning icon)
loading-owner/new-repo             ← LoadingSourceTreeItem (spinning icon)
```

### SourceTreeItem

- Label: `owner/repo` (e.g., `anthropics/skills`)
- Description: `N skill(s)`
- Icon: github
- Collapsible: yes — **starts collapsed by default**
- `contextValue`: `source`

### SkillTreeItem

- Label: skill name
- Description: skill description (truncated to 60 characters)
- Icon: green `check` if the skill is installed, `extensions` otherwise
- Collapsible: none (leaf node)
- Tooltip (markdown): name, full description, license (if present), source repo
- `contextValue`: `skill`
- Click action: opens the Skill Detail panel (`agentSkills.viewDetails`)

### LoadingSourceTreeItem

- Label: `owner/repo:path@branch` (path and branch included when present, via `repoLabel()` helper)
- Description: `Loading...`
- Icon: spinning loading icon
- Collapsible: none (leaf node)
- `contextValue`: `sourceLoading`

### FailedSourceTreeItem

- Label: `owner/repo:path@branch` (path and branch included when present, via `repoLabel()` helper)
- Description: `Failed to load`
- Icon: warning (yellow theme color)
- Collapsible: none (leaf node)
- Tooltip: markdown message with the exact repository load error
- `contextValue`: `failedSource`

---

## Data Sources

Skill repositories are configured via `agentSkills.skillRepositories`. Each entry specifies:

| Field | Description |
|---|---|
| `owner` | GitHub organization or user |
| `repo` | Repository name |
| `path` | Path within the repo where skills are stored |
| `branch` | Branch to read from (default: `main`) |
| `singleSkill` | If `true`, `path` points directly to a single skill folder rather than a directory of skills |

Default repositories include skills from `anthropics`, `github/awesome-copilot`, `pytorch`, `openai`, and `microsoftdocs`.

---

## GitHub API Strategy

Skills are fetched using the **Git Trees API** (one API call per repository), then `SKILL.md` files are read via `raw.githubusercontent.com` (no rate limit applies). This minimizes GitHub API usage regardless of how many skills a repository contains.

Results are cached in memory per `agentSkills.cacheTimeout` seconds. An optional `agentSkills.githubToken` can be configured for higher rate limits.

---

## Toolbar Actions

All actions appear in the `agentSkills.marketplace` view title bar.

| Button | Command | Description |
|---|---|---|
| Add Repository (add icon) | `agentSkills.addRepository` | Prompts for a GitHub URL and adds a new entry to `agentSkills.skillRepositories`. |
| Search (search icon) | `agentSkills.search` | Opens an input box; filters displayed skills by name or description (case-insensitive). |
| Clear Search (close icon) | `agentSkills.clearSearch` | Clears the active search filter. Only shown when a search is active (`agentSkills:searchActive` context key). |
| Refresh (refresh icon) | `agentSkills.refresh` | Clears the cache and re-fetches all skills from GitHub. Also syncs installed skill indicators. |
| Collapse All | Built-in VS Code | Collapses all source groups. Provided automatically via `showCollapseAll: true` on the TreeView. |

---

## Item Context Menu / Inline Actions

### SkillTreeItem Inline Buttons

| Button | Command | Description |
|---|---|---|
| Install (cloud-download icon) | `agentSkills.install` | Downloads and writes the skill's files to the directory defined by `agentSkills.installLocation`. Shows a progress notification. Prompts before overwriting an existing install. |
| View Details (info icon) | `agentSkills.viewDetails` | Opens the Skill Detail webview panel in the editor area, showing full `SKILL.md` content rendered as markdown. |

### SkillTreeItem Right-Click Context Menu

| Menu Item | Command | Description |
|---|---|---|
| Install | `agentSkills.install` | Same as the inline Install button. |

### SourceTreeItem / FailedSourceTreeItem Inline Buttons

| Button | Command | Description |
|---|---|---|
| Delete (trash icon) | `agentSkills.removeRepository` | Removes a source entry from `agentSkills.skillRepositories` immediately (no confirmation prompt). |

### SourceTreeItem / FailedSourceTreeItem Right-Click Context Menu

| Menu Item | Command | Description |
|---|---|---|
| Open in Browser | `agentSkills.openInBrowser` | Opens the repository on GitHub in the system default browser. Appears first in the menu (group `0_open@1`). |
| Delete | `agentSkills.removeRepository` | Removes a source entry from `agentSkills.skillRepositories` immediately (no confirmation prompt). |

---

## Add Repository Flow

`agentSkills.addRepository` workflow:

1. Prompt user for a GitHub URL.
2. Parse URL into `{ owner, repo, branch?, path? }`.
3. If branch is missing, fetch repository default branch from GitHub API.
4. If path is missing, prompt user for path (default: `skills`).
5. Build and append a `SkillRepository` entry to `agentSkills.skillRepositories` (global config).
6. Incrementally fetch only that repository and append its node/skills into the Marketplace tree.

If the repository load fails, a `FailedSourceTreeItem` is inserted instead of dropping the entry.

---

## Search Behavior

- Filtering is applied to `name` and `description` fields (case-insensitive substring match).
- Source groups containing no matching skills are hidden entirely.
- When no results match, a "No results for '…'" placeholder is shown.
- The `agentSkills:searchActive` VS Code context key is set to `true` when a query is active, enabling the Clear Search button.
- Failed repository entries are hidden while search is active.
- Loading repository entries are hidden while search is active.

---

## Ordering

- Repository groups are sorted alphabetically by `owner/repo`.
- Skills within each repository group are sorted alphabetically by skill name.
- Failed and loading repository rows are also sorted alphabetically by `owner/repo`.

---

## Incremental Updates

- `agentSkills.addRepository`: updates config, then fetches and inserts only the new repository entry.
- `agentSkills.removeRepository`: updates config, then removes only the matching repository node and related skill/failure items from the tree.
- Full refresh is still used for manual/external edits to `agentSkills.skillRepositories` and for explicit `agentSkills.refresh`.

---

## Installed Skill Indicators

The Marketplace is kept in sync with the Installed view. After any install, uninstall, or refresh of the Installed view, the set of installed skill names is pushed to the Marketplace provider. Skills whose name matches an installed skill display a checkmark icon instead of the default extensions icon.

---

## Reveal from Installed View

The Installed view's "Show in Marketplace" command calls `revealSkillByName()` on the Marketplace provider. This clears any active search, refreshes the tree, expands the parent source group, then selects and focuses the matching `SkillTreeItem` so it is highlighted. The provider implements `getParent()` and caches source/skill tree items to support `TreeView.reveal()`. Cache keys include the full repository identity (`owner/repo/path@branch/skillPath`) to avoid collisions when the same repo is configured with different branches or paths. Caches (`cachedSourceItems`, `cachedSkillItems`) are cleared at the start of every root-level `getChildren()` call and during `loadRepositoriesProgressively()` to prevent stale entries.

---

## Loading and Empty States

| State | Display |
|---|---|
| Loading | One `LoadingSourceTreeItem` per configured repository; each row resolves independently to loaded source or failed source |
| No skills and no repositories configured | "No skills available — Click refresh to load skills" |
| Search active, no matches | `No results for "<query>"` |

---

## Skill Detail Panel

Clicking a skill (or the View Details inline button) opens a `SkillDetailPanel` webview. The panel renders the full `SKILL.md` body content as markdown inside a VS Code webview. Install and Uninstall actions are available from within the panel.
