# Installed Skills View Design

## Purpose

The Installed Skills view (`agentSkills.installed`) shows all skills currently installed on the machine — both in workspace-relative folders and in user home directory folders. It is the primary interface for managing locally installed skills.

---

## Tree Structure

Skills are displayed in a two-level tree grouped by their parent install location:

```
.github/skills                    ← LocationTreeItem (folder icon)
└── my-skill                      ← InstalledSkillTreeItem (extensions icon)
~/.copilot/skills
├── another-skill
└── third-skill
```

### LocationTreeItem

- Label: the install location path (e.g., `.github/skills`, `~/.copilot/skills`)
- Icon: folder
- Collapsible: yes — expands/collapses to show/hide child skills
- Tooltip: `N skill(s) installed`
- `contextValue`: `location`

### InstalledSkillTreeItem

- Label: skill name (from `SKILL.md` frontmatter `name:`, or folder name as fallback)
- Description: skill description (from `SKILL.md` frontmatter `description:`)
- Icon: color-coded SVG based on duplicate status:
  - Purple (`skills-icon-purple.svg`) — unique skill, only one copy with that name
  - Green (`skills-icon-green.svg`) — newest copy among duplicates
  - Orange (`skills-icon-orange.svg`) — older copy among duplicates
  - Blue (`skills-icon-blue.svg`) — all copies with that name are identical
- Collapsible: yes (expands to show skill files and folders)
- Tooltip (markdown): name, description, install location
- `contextValue`: base key `installedSkill`, with duplicate status encoded via suffix:
  - `installedSkill_newest` — newest copy among duplicates
  - `installedSkill_older` — older copy among duplicates
  - `installedSkill` (no suffix) — used when there is no duplicate-specific status

---

## Scan Locations

The view scans the locations defined by the `chat.agentSkillsLocations` VS Code setting (maintained by VS Code / another extension). If that setting is not configured or is empty, the following default locations are used as a fallback:

| Location | Scope |
|---|---|
| `.agents/skills` | Current workspace |
| `.github/skills` | Current workspace |
| `.claude/skills` | Current workspace |
| `~/.agents/skills` | User home directory |
| `~/.copilot/skills` | User home directory |
| `~/.claude/skills` | User home directory |

Each location is scanned for immediate subdirectories. A subdirectory is considered a valid skill if it contains a `SKILL.md` file. Locations that don't exist are silently skipped. Skill locations are normalized to forward slashes at scan time (via `normalizeSeparators()`) so all downstream path comparisons work consistently across platforms.

---

## Toolbar Actions

All actions appear in the `agentSkills.installed` view title bar.

| Button | Command | Description |
|---|---|---|
| Search (search icon) | `agentSkills.searchInstalled` | Opens an input box; filters displayed skills by name or description (case-insensitive). |
| Clear Search (close icon) | `agentSkills.clearSearchInstalled` | Clears the active search filter. Only shown when a search is active (`agentSkills:installedSearchActive` context key). |
| Refresh | `agentSkills.refreshInstalled` | Re-scans all skill locations and refreshes the tree. Also syncs installed skill names back to the Marketplace view. |
| Install Location (folder icon) | `agentSkills.selectInstallLocation` | Opens a QuickPick to change `agentSkills.installLocation`. Selecting "Custom..." opens `settings.json` with the cursor on the setting. |
| Expand All | `agentSkills.expandAll` | Expands all location groups. Uses `TreeView.reveal()` (requires `getParent()` implementation). |
| Collapse All | `agentSkills.collapseAll` | Collapses all location groups. Delegates to the built-in `workbench.actions.treeView.agentSkills.installed.collapseAll` command. |

---

## Search Behavior

- Filtering is applied to `name` and `description` fields (case-insensitive substring match).
- Location groups containing no matching skills are hidden entirely.
- When no results match, a "No results for '…'" placeholder is shown.
- The `agentSkills:installedSearchActive` VS Code context key is set to `true` when a query is active, enabling the Clear Search button.

---

## Item Context Menu Actions

### InstalledSkillTreeItem Right-Click Context Menu

| Menu Item | Command | Visibility | Description |
|---|---|---|---|
| Move to... | `agentSkills.moveSkill` | Always | Opens a QuickPick listing all scan locations (current location marked). Moves the skill folder to the selected location. |
| Copy to... | `agentSkills.copySkill` | Always | Opens a QuickPick listing all scan locations (current location marked). Copies the skill folder to the selected location, keeping the original. |
| Update older skill copies with latest | `agentSkills.syncSkill` | Newest (green) only | Copies this skill to all other locations that have an older copy. |
| Get latest copy of skill | `agentSkills.getLatestSkill` | Older (orange) only | Replaces this copy with the newest version from another location. |
| Delete | `agentSkills.uninstall` | Always | Deletes the skill folder (moved to trash, no confirmation prompt). |
| Show in Marketplace | `agentSkills.showInMarketplace` | Always | Reveals and highlights the matching skill in the Marketplace tree view. |

### InstalledSkillTreeItem Inline Buttons

| Button | Command | Description |
|---|---|---|
| Delete (trash icon) | `agentSkills.uninstall` | Deletes the skill folder immediately (moved to trash, no confirmation prompt). |
| Open Skill Folder (folder-opened icon) | `agentSkills.openSkillFolder` | Reveals the skill folder in the Explorer and opens `SKILL.md` in the editor. |

### LocationTreeItem Right-Click Context Menu

| Menu Item | Command | Description |
|---|---|---|
| Delete | `agentSkills.deleteAllSkills` | Deletes all skills under this location folder (moved to trash). |

---

## Expand/Collapse State Persistence

The collapsed/expanded state of each location group is persisted in `workspaceState` under the key `agentSkills.collapsedLocations` (stored as a `string[]` of collapsed location paths).

- State is loaded on extension activation and applied when the tree is first rendered.
- State is updated whenever the user manually expands or collapses a group (`onDidExpandElement` / `onDidCollapseElement` events).
- Expand All and Collapse All also update and persist state.

---

## Marketplace Sync

After any refresh or install/uninstall operation, the set of installed skill names is pushed to the Marketplace view via `marketplaceProvider.setInstalledSkills()`. This allows the Marketplace to show a checkmark icon on already-installed skills.

---

## Empty State

When no skills are installed, a welcome message is shown:

```
No skills installed yet.
[Browse Marketplace]
```

Clicking the link focuses the Marketplace view.

---

## File Watchers

The extension watches for `SKILL.md` creation and deletion events in workspace skill folders. Any change triggers `syncInstalledStatus()`, which refreshes the Installed view and updates the Marketplace's installed indicators.

Additionally, file watchers are created for all scan locations (workspace-relative and home directory) to monitor any file changes within skill folders. When a file is created, changed, or deleted:

1. The owning skill is identified by matching the file URI against resolved skill location URIs.
2. The duplicate status is recomputed for that skill and all other skills sharing the same name.
3. The tree view is refreshed so icons update.

Events are debounced (500ms) to avoid excessive recomputation during rapid edits. The provider implements `vscode.Disposable` and manages watchers internally via an `activeWatchers` array; it is registered in `context.subscriptions` so all watchers are cleaned up on extension deactivation. Watchers are recreated on every refresh and when `chat.agentSkillsLocations` changes, ensuring new location directories are automatically watched.

---

## Duplicate Skill Detection

When the same skill name appears in multiple scan locations, the extension compares the copies to determine their relative freshness.

### Comparison Algorithm

For each pair of duplicate skills:

1. Recursively collect all files in both skill directories.
2. Sort files with `SKILL.md` first, then alphabetically by relative path.
3. For each shared file:
   - If both are text-based files and their contents are identical, the file is considered equivalent (date comparison is skipped).
   - Otherwise, compare modification timestamps (`mtime`). The copy with the newer timestamp wins.
4. If all shared files are equivalent, the copy with more files is considered newer.
5. If everything is equal, the copies are considered identical.

### Text File Detection

Files are considered text-based if their extension matches a known set (`.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.toml`, `.xml`, `.html`, `.css`, `.js`, `.ts`, `.py`, `.ps1`, `.sh`, `.svg`, etc.) or if the filename starts with `.` (dotfiles like `.gitignore`).

### Status Assignment

| Status | Icon Color | Meaning |
|---|---|---|
| `unique` | Purple | Only one copy of this skill name exists |
| `newest` | Green | This copy has the latest files among duplicates |
| `older` | Orange | A newer copy exists elsewhere |
| `same` | Blue | All copies are identical |

