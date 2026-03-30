# Agent Organizer Extension Design

## Overview

The Agent Organizer extension provides a VS Code interface for browsing, downloading, and managing reusable AI content — agents, hooks, instructions, plugins, prompts, and skills — from GitHub repositories.

The extension adds an **Agent Organizer** activity bar container with 8 tree views:

- **Marketplace** — Browse and download content from configured GitHub repositories across all content areas.
- **Agents** — View and manage installed agent files (`*.agent.md`).
- **Hooks - GitHub** — View and manage installed GitHub-style hooks (folders with `hooks.json`).
- **Hooks - Kiro** — View and manage installed Kiro-style hooks (`*.json` files).
- **Instructions** — View and manage installed instruction files (`*.instructions.md`).
- **Plugins** — View and manage installed plugins (folders with `plugin.json`).
- **Prompts / Commands** — View and manage installed prompt files (`*.prompt.md`).
- **Skills** — View and manage installed skills (folders with `SKILL.md`). Has additional features: duplicate detection, move/copy, sync.

---

## VS Code Configuration

| Setting | Type | Default | Description |
|---|---|---|---|
| `agentOrganizer.skillRepositories` | array | (6 defaults) | GitHub repositories to fetch content from. Each entry has `owner`, `repo`, and `branch`. Rendered inline in the Settings UI. Read/written via `readRepositoriesConfig()` / `writeRepositoriesConfig()`. |
| `agentOrganizer.installLocations` | object | `~/.copilot/{area}` per area | Per-area default download locations. Keys are area identifiers (`agents`, `hooksGithub`, `hooksKiro`, `instructions`, `plugins`, `prompts`, `skills`). Created automatically on first activation if not present. |
| `agentOrganizer.githubToken` | string | `""` | Optional GitHub personal access token for higher API rate limits. |
| `agentOrganizer.cacheTimeout` | number | `3600` | Seconds before cached marketplace data expires. |

Each area's list of possible download locations is resolved from its `chat.*` configuration key (e.g., `chat.agentFilesLocations` for agents, `chat.pluginLocations` for plugins, `chat.agentSkillsLocations` for skills). If the config key is not set, a default list is generated from 6 template prefixes (`{.agents,.claude,.github,~/.agents,~/.claude,~/.copilot}/{area}`). Hooks - Kiro is fixed to `.kiro/hooks`.

Related external settings: each area view scans locations from its own `chat.*` setting (e.g. `chat.agentFilesLocations` for agents, `chat.pluginLocations` for plugins). When the setting isn't configured, a default list is generated from the template prefixes. The configured download location from `agentOrganizer.installLocations` is always included in the scan.

---

## Content Areas

The extension recognizes 7 active content areas (Powers is excluded, still being planned):

**Multi-file areas** (folder-based, with a definition file):
- Skills — `SKILL.md` (YAML frontmatter)
- Plugins — `plugin.json` (JSON)
- Hooks - GitHub — `hooks.json` in `hooks/` subfolders, `conventionalOnly`

**Single-file areas** (individual files matching a suffix):
- Agents — `*.agent.md`
- Instructions — `*.instructions.md`
- Prompts / Commands — `*.prompt.md`
- Hooks - Kiro — `*.json` in `hooks/` directory, `conventionalOnly`

Each area has a unique icon design and color. Hooks - GitHub and Hooks - Kiro share the same icon (via `iconPrefix`) and conventional directory (`hooks/`) but are mutually exclusive per repository — if GitHub-style hooks are found, Kiro-style discovery is skipped.

---

## Installed Area Views

Each content area (except Skills, which has its own dedicated provider) uses the generic `InstalledAreaTreeDataProvider` (`src/views/installedAreaProvider.ts`). This provider:

- Scans locations from the area's own `chat.*` setting (e.g. `chat.agentFilesLocations` for agents), falling back to generated defaults
- Also includes the area's configured default download location from `agentOrganizer.installLocations`
- Groups items by install location under `AreaLocationTreeItem` nodes with colored folder icons
- Multi-file items (`AreaInstalledItemTreeItem`) expand to show folder contents
- Multi-file items use recursive definition file search (e.g., `plugin.json` may be nested within the item folder)
- Single-file items open in the editor on double-click
- Each view has its own Search, Clear Search, Refresh, Default Download Location, and Expand All toolbar commands
- "Searching for installed {area}..." loading message with spinner during initial scan (see known issue in `areaViewLoading.design.md`)
- Welcome messages ("No {area} found.") when empty after scan
- File watchers auto-refresh when items are created or deleted (including watchers on the default download location)
- View title displays the area-colored icon

### Right-click menus (area views)

| Node Type | Context Value | Actions |
|---|---|---|
| Location | `areaLocation` | Move to..., Copy to..., Delete, Reveal in File Explorer |
| Multi-file item | `areaInstalledFolder` | Add File, Add Folder, Move to..., Copy to..., Copy to Plugin... (not in Plugins view), Show in Marketplace, Reveal in File Explorer, Delete (inline + menu), View Installed Item (inline) |
| Single-file item | `areaInstalledFile` | Move to..., Copy to..., Copy to Plugin..., Show in Marketplace, Reveal in File Explorer, Delete (inline + menu), View Installed Item (inline) |
| Subfolder | `areaItemFolder` | Add File, Add Folder, Delete, Reveal in File Explorer |
| File | `areaItemFile` | Rename, Delete, Reveal in File Explorer |

Additional Plugins view commands:

| Node Type | Context Value | Actions (Plugins view only) |
|---|---|---|
| Plugin item | `areaInstalledFolder` | Get latest copy of AI tools |
| Area subfolder | `areaItemFolder` | Get latest copies, Copy to area |
| Item in subfolder | `areaItemFile` | Get latest copy, Copy to area |
| Folder in subfolder | `areaItemFolder` | Get latest copy (delegates to folder or item sync based on folder name) |

"Reveal in File Explorer" appears at the bottom of all right-click menus (group `9_reveal`), except on installed items (skills and area items) where it groups with "Show in Marketplace" (group `3_marketplace`).

---

## Marketplace View (summary)

Fetches content from configured repositories using the GitHub Git Trees API (one API call per repository). On every load/refresh, area discovery scans each repository's tree to find which content areas exist. Content is grouped by repository → area → items. Users can search, view details, download skills, add repositories by URL, and remove repositories. See `marketplace.design.md` for full details.

## Skills View (summary)

The Skills view uses its own dedicated `InstalledSkillsTreeDataProvider` with additional features not available in other area views: duplicate detection with color-coded icons, move/copy between locations, sync/get-latest for duplicates, and marketplace integration (Show in Marketplace). See `installedSkills.design.md` for full details.

---

## Services

| Service | Responsibility |
|---|---|
| `GitHubSkillsClient` | Fetches content from GitHub. Uses Git Trees API for efficiency; `raw.githubusercontent.com` for file content (no rate limit). Discovers content areas via `discoverAreas()`. Fetches all area content via `fetchRepoContent()`. Parses `plugin.json`/`hooks.json` as JSON and markdown files via YAML frontmatter. For JSON-based areas, also fetches `README.md` for detail panel body content. Caches results per `agentOrganizer.cacheTimeout`. |
| `SkillPathService` | Resolves location strings (including `~` home paths) to `vscode.Uri` values. Provides scan locations, per-area default download locations (`getDefaultDownloadLocation(area)`), and install target resolution. Manages `agentOrganizer.installLocations` config (read, write, ensure defaults on activation). |
| `SkillInstallationService` | Downloads, deletes, moves, copies, syncs skills. Uses area-specific download locations based on `skill.area`. Handles overwrite confirmation, progress notifications, and trash-based deletion. |
| `PluginSyncService` | Handles "Get latest copy" and "Copy to area" operations for plugin subfolders. Maps plugin subfolder names to content areas (`agents→agents`, `skills→skills`, `commands→prompts`, `hooks→hooksGithub`). Provides `syncPluginItem()` with `SyncResult` including failure reasons. |

---

## Shared Utilities (`types.ts`)

| Item | Description |
|---|---|
| `ContentArea` | Union type of all area keys (agents, hooksGithub, hooksKiro, instructions, plugins, powers, prompts, skills). |
| `ALL_CONTENT_AREAS` | Active areas array (excludes powers). |
| `AREA_DEFINITIONS` | Metadata for each area: label, icon, kind, file suffix/definition file, conventionalOnly, iconPrefix, conventionalDir. |
| `AreaPaths` | Partial record mapping areas to their discovered directory paths. |
| `isSameRepository(a, b)` | Compares repositories by owner, repo, and branch. |
| `normalizeSeparators(p)` | Replaces backslashes with forward slashes. |
| `normalizeRepository(r)` | Defaults `branch` to `'main'`. |
| `parseRepositoryEntry(e)` | Parses a config entry (string `owner/repo@branch` or object) into a `SkillRepository`. |
| `readRepositoriesConfig()` | Reads `agentOrganizer.skillRepositories`, handling both string and object formats. |
| `writeRepositoriesConfig(repos)` | Writes repositories as objects to `agentOrganizer.skillRepositories`. |
| `buildGitHubUrl(...)` | Builds a GitHub tree URL with URL-encoded segments. |

---

## File Watchers

The Skills view watches for `SKILL.md` creation/deletion events in workspace skill folders with debounced duplicate status recomputation. Each area view creates its own file watchers for its specific file patterns (e.g., `**/{areaDir}/*/{definitionFile}` for multi-file areas, `**/{areaDir}/**/*{suffix}` for single-file areas), including watchers on the area's configured default download location. Watchers are recreated on refresh.
