# Marketplace View Design

## Purpose

The Marketplace view (`AIToolsOrganizer.marketplace`) lets users browse content from configured GitHub repositories across multiple content areas (agents, hooks, instructions, plugins, prompts, skills), search by name or description, view details, and download items.

---

## Content Areas

The extension recognizes 8 content areas, each with its own detection pattern and icon:

| Area | Kind | Detection | Definition File / Suffix | Icon |
|---|---|---|---|---|
| Agents | singleFile | `*.agent.md` | `.agent.md` | Teal robot |
| Hooks - GitHub | multiFile | Folders with `hooks.json` in `hooks/` | `hooks.json` | Amber hook |
| Hooks - Kiro | singleFile | `*.json` in `hooks/` | `.json` | Amber hook |
| Instructions | singleFile | `*.instructions.md` | `.instructions.md` | Slate clipboard |
| Plugins | multiFile | Folders with `plugin.json` | `plugin.json` (JSON) | Cyan plug |
| Prompts / Commands | singleFile | `*.prompt.md` | `.prompt.md` | Pink chat bubble |
| Skills | multiFile | Folders with `SKILL.md` | `SKILL.md` | Purple star-document |

Hooks - GitHub and Hooks - Kiro are mutually exclusive per repository: if GitHub-style hooks are found, Kiro-style discovery is skipped.

---

## Tree Structure

Content is displayed in a multi-level tree: repositories → area groups → items.

```
github/awesome-copilot            ← SourceTreeItem (github icon, collapsed)
├── Agents 183                    ← AreaGroupTreeItem (teal, collapsed)
│   ├── subfolder                 ← AreaFolderTreeItem
│   │   └── my-agent             ← AreaFileTreeItem
│   └── other-agent              ← AreaFileTreeItem
├── Hooks - GitHub 6              ← SkillsGroupTreeItem (amber, collapsed)
│   └── dependency-checker        ← SkillTreeItem
├── Instructions 174              ← AreaGroupTreeItem (slate, collapsed)
├── Plugins 54                    ← SkillsGroupTreeItem (cyan, collapsed)
│   └── polyglot-test-agent       ← SkillTreeItem
└── Skills 254                    ← SkillsGroupTreeItem (purple, collapsed)
    └── automate-this             ← SkillTreeItem
```

### Node Types

| Node | Description | Context Value |
|---|---|---|
| `SourceTreeItem` | Repository root. Label: `owner/repo`. Icon: github. Description: total item count. | `source` |
| `SkillsGroupTreeItem` | Area group for multi-file items. Shows area label and count. Uses area-colored icon. | `skillsGroup` |
| `AreaGroupTreeItem` | Area group for single-file items. Shows area label and count. Uses area-colored icon. | `areaGroup` |
| `SkillTreeItem` | Individual multi-file item (skill, plugin, power, hook). Click opens detail panel. | `skill` |
| `AreaFileTreeItem` | Individual single-file item (agent, instruction, prompt). Click opens detail panel. | `areaFile` |
| `AreaFolderTreeItem` | Subfolder within a single-file area. | `areaFolder` |
| `FailedSourceTreeItem` | Repository that failed to load. Warning icon with error tooltip. | `failedSource` |
| `LoadingSourceTreeItem` | Repository currently loading. Spinning icon. | `sourceLoading` |

---

## Data Sources

Repositories are configured via `AIToolsOrganizer.skillRepositories`. Each entry specifies:

| Field | Description |
|---|---|
| `owner` | GitHub organization or user |
| `repo` | Repository name |
| `branch` | Branch to read from (default: `main`) |

Entries are rendered inline in the VS Code Settings UI with editable fields. The config supports both object format (`{ owner, repo, branch }`) and compact string format (`owner/repo@branch`). All read/write operations go through `readRepositoriesConfig()` / `writeRepositoriesConfig()` in `types.ts`.

Area paths are discovered automatically on every load/refresh — they are not stored in config.

---

## Area Discovery

On load/refresh, each repository's tree is scanned via the Git Trees API (1 API call, cached).

**Step 1 — Conventional names:** Check for top-level directories matching area names (`agents/`, `hooks/`, `instructions/`, `plugins/`, `prompts/`, `skills/`). Verify each contains matching content before registering.

**Step 2 — Fallback search:** For areas not found in step 1 (excluding `conventionalOnly` areas like hooks), search the full tree for matching files, excluding paths under already-discovered areas.

**Exclusion logic:** When fetching content for an area, files under other areas' paths are excluded. Areas sharing the same directory (e.g., Hooks - GitHub and Hooks - Kiro both use `hooks/`) do not exclude each other.

---

## GitHub API Strategy

Content is fetched using the Git Trees API (1 call per repo, recursive) + `raw.githubusercontent.com` for file content (no rate limit). Definition files (`SKILL.md`, `POWER.md`, `plugin.json`, `README.md`) are fetched via raw URLs to extract names and descriptions. `plugin.json` files are parsed as JSON; all others use YAML frontmatter parsing.

Repositories are loaded progressively with a concurrency limit of 2. This prevents event loop starvation that would otherwise delay local filesystem operations (installed item scans) when many repositories are configured.

Results are cached in memory per `AIToolsOrganizer.cacheTimeout` seconds.

---

## Toolbar Actions

| Button | Command | Description |
|---|---|---|
| Add Repository (add icon) | `AIToolsOrganizer.addRepository` | Prompts for a GitHub URL and adds a new entry to `AIToolsOrganizer.skillRepositories`. |
| Search (search icon) | `AIToolsOrganizer.search` | Opens an input box; filters displayed items by name or description (case-insensitive). |
| Clear Search (close icon) | `AIToolsOrganizer.clearSearch` | Clears the active search filter. Only shown when a search is active. |
| Refresh (refresh icon) | `AIToolsOrganizer.refresh` | Clears the cache and re-fetches all content from GitHub. |
| Collapse All | Built-in VS Code | Collapses all groups. |

---

## Item Context Menu / Inline Actions

### SkillTreeItem (multi-file items)

| Action | Type | Command | Description |
|---|---|---|---|
| Download | inline + menu | `AIToolsOrganizer.install` | Downloads the item to the configured install location. |
| View Details | inline | `AIToolsOrganizer.viewDetails` | Opens the detail webview panel. |
| Open in Browser | menu | `AIToolsOrganizer.openInBrowser` | Opens the item's GitHub folder. |

### AreaFileTreeItem (single-file items)

| Action | Type | Command | Description |
|---|---|---|---|
| Download | inline + menu | `AIToolsOrganizer.install` | Fetches the file from GitHub and writes it to the area's default download location. |
| View Details | inline + click | `AIToolsOrganizer.viewFileDetails` | Fetches file content and opens the detail panel. |
| Open in Browser | menu | `AIToolsOrganizer.openInBrowser` | Opens the file on GitHub (blob URL). |

### SkillsGroupTreeItem / AreaGroupTreeItem (area groups)

| Action | Type | Command | Description |
|---|---|---|---|
| Open in Browser | menu | `AIToolsOrganizer.openInBrowser` | Opens the area's directory on GitHub. |

### SourceTreeItem / FailedSourceTreeItem (repositories)

| Action | Type | Command | Description |
|---|---|---|---|
| Delete | inline | `AIToolsOrganizer.removeRepository` | Removes the repository from config. |
| Open in Browser | menu | `AIToolsOrganizer.openInBrowser` | Opens the repository on GitHub. |

---

## Add Repository Flow

1. Prompt user for a GitHub URL.
2. Parse URL into `{ owner, repo, branch? }`.
3. If branch is missing, fetch default branch from GitHub API.
4. Save `{ owner, repo, branch }` to `AIToolsOrganizer.skillRepositories`.
5. Area discovery and content fetching happen automatically on load.

---

## Detail Panel

Clicking a multi-file item (skill, plugin, hook) or single-file item (agent, instruction, prompt) opens a `SkillDetailPanel` webview. The panel title reflects the area type (e.g., "Hooks - GitHub: Dependency License Checker").

- For markdown-based areas (Skills, single-file areas): the README tab shows the rendered markdown body; Raw Source shows the full file content.
- For JSON-based multi-file areas (Hooks - GitHub, Plugins): the panel fetches `README.md` from the item's folder (also checks the item root if the definition file is nested). The README tab shows the rendered README markdown; Raw Source shows the raw README content. A third tab shows the raw definition file (e.g. `plugin.json`, `hooks.json`). Name and description are taken from the JSON definition file, with README frontmatter as fallback.
- When no README.md is found for JSON-based areas, the README tab shows "No README.md found." instead of the generic "No additional details available."
- For single-file items, the file content is fetched on demand via `AIToolsOrganizer.viewFileDetails`.

---

## Icons

Each area has a unique icon design in its own color for group nodes and view titles:

| Area | Icon | Color |
|---|---|---|
| Agents | Robot | Teal |
| Hooks | Hook/branch | Amber |
| Instructions | Clipboard | Slate |
| Plugins | Plug | Cyan |
| Prompts / Commands | Chat bubble | Pink |
| Skills | 3D Package/box | Purple |

Individual items use the same icon shape in 4 status colors:
- Area color (default) — unique item
- Green — newest duplicate
- Orange — older duplicate
- Blue — identical copies

Areas sharing the same icon (Hooks - GitHub and Hooks - Kiro) use the `iconPrefix` override.

---

## Installed Status Indicators

Items that exist locally (downloaded or manually placed) display a green check icon (`testing.iconPassed` theme color) instead of their default area icon. This applies to all content areas:

- `SkillTreeItem` (multi-file items): checks against both `installedSkillNames` and `installedItemNames`.
- `AreaFileTreeItem` (single-file items): checks against `installedItemNames`.

The installed name sets are updated via `setInstalledSkills()` (skills only) and `setInstalledItemNames()` (all areas combined). Both are called from `syncInstalledStatus()` after every install, uninstall, move, copy, or delete operation.
