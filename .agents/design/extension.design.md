# Agent Skills Extension Design

## Overview

The Agent Skills extension provides a VS Code interface for browsing, installing, and managing Agent Skills — reusable instruction sets (defined by `SKILL.md` files) that AI coding agents such as GitHub Copilot and Claude can load as context.

The extension adds an **Agent Skills** activity bar container with two tree views:

- **Marketplace** — Browse and install skills from configured GitHub repositories.
- **Installed** — View and manage skills installed locally (in the workspace or user home directory).

---

## VS Code Configuration

Primary settings are under the `agentSkills` namespace. The Installed scan-location list is sourced from `chat.agentSkillsLocations` (provided by VS Code / another extension).

| Setting | Type | Default | Description |
|---|---|---|---|
| `agentSkills.skillRepositories` | array | (6 defaults) | GitHub repositories to fetch marketplace skills from. Each entry has `owner`, `repo`, `path`, `branch`, and optional `singleSkill` flag. |
| `agentSkills.installLocation` | string | `.github/skills` | Where newly installed skills are written. Must be one of the paths listed in `chat.agentSkillsLocations`. No longer restricted to a fixed enum. |
| `agentSkills.githubToken` | string | `""` | Optional GitHub personal access token for higher API rate limits. |
| `agentSkills.cacheTimeout` | number | `3600` | Seconds before cached marketplace data expires. |

Related external setting: `chat.agentSkillsLocations` provides the location list used by Installed view scans and install-location validation.

Paths starting with `~` are resolved to the user's home directory. All other paths are relative to the first open workspace folder.

---

## Skill Format

Each skill is a folder containing at minimum a `SKILL.md` file. The file uses YAML frontmatter for metadata:

```markdown
---
name: my-skill
description: What this skill does
license: MIT
---
Skill body content...
```

The extension reads `name` and `description` from the frontmatter. Skills without a valid `SKILL.md` are ignored.

When a skill is installed from the Marketplace, an `agent-skills-source` line is injected as the last entry in the SKILL.md frontmatter, recording the GitHub source URL (e.g., `agent-skills-source: https://github.com/owner/repo/tree/main/skills/my-skill`). If the frontmatter already contains this key it is replaced; if no frontmatter exists one is created.

---

## Marketplace View (summary)

Fetches skills from the configured `agentSkills.skillRepositories` list using the GitHub Git Trees API (one API call per repository). Skills are grouped by source repository (`owner/repo`) and displayed in a collapsible tree. Loading is progressive per repository (each source appears immediately with a loading indicator, then resolves to loaded or failed state). Users can search, view details, install skills, add repositories by URL, and remove repositories from this view. Repositories that fail to load are still shown with a warning indicator and error tooltip. Repository and skill rows are alphabetically ordered. See `marketplace.design.md` for full details.

## Installed View (summary)

Scans all known skill locations (workspace-relative and home-directory paths) for installed skills and displays them grouped by install location. Users can uninstall, move, and copy skills, open their folder, change the active install location, and expand/collapse location groups. Skills with the same name in multiple locations are detected and shown with color-coded icons indicating their relative freshness. See `installedSkills.design.md` for full details.

---

## Services

| Service | Responsibility |
|---|---|
| `GitHubSkillsClient` | Fetches skill listings and file content from GitHub. Uses Git Trees API for efficiency; falls back to `raw.githubusercontent.com` for file content (no rate limit). Also resolves repository default branches for URL-based repository adds. Caches results per `agentSkills.cacheTimeout`. |
| `SkillPathService` | Resolves location strings (including `~` home paths) to `vscode.Uri` values. Provides the scan location list (read from `chat.agentSkillsLocations`, with a built-in default fallback) and the current install location. |
| `SkillInstallationService` | Installs, deletes, moves, copies, syncs, and gets-latest for skills. Copies all files from GitHub into the resolved install target directory. Confirms overwrites with the user. Move and copy operations use a QuickPick to select the target scan location (current location marked); both normalize path separators and guard against selecting the same directory as the source. Delete sends the skill folder to trash without confirmation. Sync copies the newest skill to all other locations with older copies. Get-latest replaces an older copy with the newest version. Delete-all removes every skill under a location folder. |

---

## Shared Utilities (`types.ts`)

| Function | Description |
|---|---|
| `isSameRepository(a, b)` | Compares two `SkillRepository` entries by owner, repo, path, branch, and singleSkill. Used by both the Marketplace provider and extension commands (add/remove repository). |
| `normalizeSeparators(p)` | Replaces backslashes with forward slashes. Used throughout the codebase (installed provider, installation service) to ensure consistent path separators on all platforms. |

---

## File Watchers

The extension watches for `SKILL.md` creation and deletion events in workspace skill folders. Watcher patterns are derived from `pathService.getScanLocations()` (workspace-relative entries only) rather than being hardcoded, so user-configured scan locations are automatically covered.

Additionally, file watchers are created for all scan locations (both workspace-relative and home directory paths) to monitor file changes within skill folders. When a file changes, the duplicate status is recomputed for the affected skill and all other skills sharing the same name. The `InstalledSkillsTreeDataProvider` implements `vscode.Disposable` and manages watchers internally via an `activeWatchers` array. The provider is registered in `context.subscriptions` so all watchers are cleaned up on extension deactivation. Watchers are recreated on every refresh and when `chat.agentSkillsLocations` changes, ensuring new location directories are automatically watched. File change events are debounced (500ms) to avoid excessive recomputation during rapid edits.
