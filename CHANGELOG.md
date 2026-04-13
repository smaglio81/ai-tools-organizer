# Change Log

All notable changes to the "ai-tools-organizer" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.2.0]

### Changed

- The Visual Studio Marketplace reviewer (representative:80c2ec86) felt that the new extension name "Agent Organizer" was too close to the name of the original extension this was hard forked from. They required a rename and new description.
- Renamed extension display name from "Agent Organizer" to "AI Tools Organizer".
- Renamed GitHub repository from `agent-organizer` to `ai-tools-organizer`.
- All command IDs, view IDs, configuration keys, and context keys updated from `agentOrganizer.*` to `AIToolsOrganizer.*`.
- Renamed image assets from `agent-organizer-*` to `ai-tools-organizer-*`.

### Added

- Settings migration: on first activation, existing user/workspace settings under the old `agentOrganizer.*` prefix are automatically copied to `AIToolsOrganizer.*`. Migration runs once and is tracked via global state.

## [0.1.0]

### Added

- "Copy #{path}" right-click option on installed items in Skills and all area views.
- "Copy #{path}" right-click option on subfolders/files inside installed multi-file items.
- "Copy Absolute Path" right-click option on all items, subfolders, and files. Copies the fully resolved filesystem path (with capitalized drive letter on Windows).
- Path references are copied in chat-ready format (for example: `#~/.copilot/skills/my-skill/docs/guide.md`).
- Unit tests for path-reference building across installed skill and area tree nodes.
- "Duplicate" right-click option on all installed area items and skills. Creates a copy of the item with a new name in the same location, updating the definition file name.

### Changed

- Marketplace repository loading throttled to 2 concurrent fetches (down from all at once). Prevents event loop starvation that was delaying local installed item scans.
- Prompt workflow files moved under `.github/prompts/`.
- Version bumped from `0.0.8` to `0.1.0`.

## [0.0.8]

### Added

- "Rename" right-click option on all installed area items and skills. Renames the folder (multi-file) or file (single-file) on disk and updates the `name` field in the definition file (YAML frontmatter or JSON).
- "Copy Name" right-click option on all installed area items and skills. Copies the item name to the clipboard.
- `.kiro/{area}` and `~/.kiro/{area}` added to default location template prefixes (now 8 prefixes total).

### Changed

- Rename and Copy Name appear in their own menu group (`0_rename`) above Move to... / Copy to..., in the order: Rename, Copy Name.
- `install:vsix` / `uninstall:vsix` scripts updated to use `code-insiders`. Added `install:vsix:kiro`, `uninstall:vsix:kiro`, `reinstall:vsix`, and `reinstall:vsix:kiro` convenience scripts.

## [0.0.7]

### Added

- "Add {Area}" button in all view title bars (between Default Download Location and Expand All). Opens a location quick pick, then prompts for a name and creates a new item with area-specific scaffolding. Custom paths are validated (relative or `~` only, no `..`, no invalid characters). If the path ends in `.md`, the last segment is used as the item name.
- "Add {Area}" right-click option on location folders in all views (first item in the menu). Prompts for a name and creates a new item at that location.
- Area-specific scaffolding for new items:
  - Skills: folder + `SKILL.md` with frontmatter (`name`, `description`, `metadata.version` as today's date)
  - Agents: `{name}.agent.md` with frontmatter (`name`, `description`)
  - Hooks - GitHub: folder + `README.md` (frontmatter with `name`, `description`, `tags`, `metadata.version`) + `{name}.hooks.json`
  - Hooks - Kiro: folder + `README.md` (frontmatter with `name`, `description`, `tags`, `metadata.version`) + `{name}.hooks.json`
  - Instructions: `{name}.instructions.md` with frontmatter (`name`, `description`)
  - Plugins: folder + `README.md` + `plugin.json` + `.mcp.json` + `.claude-plugin/plugin.json`
  - Prompts: `{name}.prompt.md` with frontmatter (`name`, `description`)
- Name normalization for new items: lowercase, non-alphanumeric characters replaced with dashes, multiple dashes collapsed.
- `src/test/addItem.test.ts` — 14 tests covering name normalization, date stamping, and skill scaffolding creation.

## [0.0.6]

### Added

- "Update Plugins" right-click option on installed items in Agents, Skills, Prompts / Commands, and Hooks - GitHub views. Searches all installed plugins for a copy of the item in the plugin's corresponding area subfolder (`/agents`, `/skills`, `/commands`, `/hooks`) and overwrites it with the current version. Results shown via output channel with per-plugin ✅/❌ status; toast notification includes "Show Details" button.

### Changed

- Extension logo (`resources/logo.svg`, `resources/logo.png`) updated to use the activity bar icon design (three-book "AI" motif) in purple (`#B07FE0`) on a transparent background, replacing the previous gear-on-blue-circle design.

## [0.0.5]

### Added

- Multi-area content support: the Marketplace now discovers and displays content areas from repositories:
  - Agents (single-file, `*.agent.md`)
  - Hooks - GitHub (multi-file, folders with `hooks.json`)
  - Hooks - Kiro (single-file, `*.json` in `hooks/` directory)
  - Instructions (single-file, `*.instructions.md`)
  - Plugins (multi-file, folders with `plugin.json`)
  - Prompts (single-file, `*.prompt.md`)
  - Skills (multi-file, folders with `SKILL.md`)
- Automatic area discovery: on every load/refresh, each repository's tree is scanned to detect which content areas exist. Top-level directories matching conventional area names are checked first; a fallback search handles non-standard layouts.
- Area exclusion logic: files under one area's directory are excluded from other areas' searches (e.g., a `.prompt.md` inside a plugin folder won't appear under Prompts).
- Unique color-coded icons for each area (7 area shapes × 4 status colors + 7 area-colored group icons).
- Area group nodes under each repository in the Marketplace tree, each with its own icon and item count.
- Single-file area items (Agents, Instructions, Prompts) support click-to-view-details, inline "View Details" button, and right-click "Open in Browser".
- `AIToolsOrganizer.viewFileDetails` command: fetches single-file content from GitHub and opens the detail panel.
- "Open in Browser" right-click menu on area group nodes (opens the area's directory on GitHub).
- `plugin.json` files are parsed as JSON to extract `name` and `description` for Plugins.
- New Activity Bar icon (books/library design using `currentColor`).
- New installed views for each content area (Agents, Hooks - GitHub, Hooks - Kiro, Instructions, Plugins, Prompts) alongside the existing Skills view. Each view:
  - Scans local scan locations for area-specific content (e.g., `~/.claude/agents`, `~/.copilot/hooks`)
  - Has its own Search, Clear Search, and Refresh toolbar commands
  - Groups items by install location with colored folder icons
  - Multi-file items expand to show folder contents
  - Single-file items open in the editor on double-click
  - Right-click menus match the Skills view: Delete, Reveal in File Explorer, Add File/Add Folder (multi-file only), Rename (files), Open Folder (multi-file inline)
  - File watchers auto-refresh when items are created or deleted
  - "Move to..." and "Copy to..." on items and location folders
  - Expand All toolbar button
  - "Searching for installed {area}..." loading message with spinner
  - Welcome messages ("No {area} found.") when empty
  - "View Installed Item" inline button on all items: opens the definition file (single-file areas open the file directly; multi-file areas open the definition file, searching recursively for plugins)
- "Move to..." and "Copy to..." added to top-level location folders in all views (Skills and area views)
- View title icons: each view displays its area-colored icon in the title
- For JSON-based multi-file areas (Hooks - GitHub, Plugins), the detail panel now fetches and renders `README.md` from the item's folder. The README tab shows rendered markdown; Raw Source shows the raw README content. Name and description fall back to README frontmatter if not provided by the JSON definition file.
- Per-area "Default Download Location" button in all view title bars (Skills and all area views). Each area can have its own configured download location via `AIToolsOrganizer.installLocations`.
- `AIToolsOrganizer.installLocations` setting: an object with per-area default download locations. Defaults to `~/.copilot/{area}` for each area (hooksKiro defaults to `.kiro/hooks`). Created automatically in user settings on first activation if not present.
- Each area resolves its list of possible download locations from its `chat.*` configuration key (e.g., `chat.agentFilesLocations` for agents, `chat.pluginLocations` for plugins). Falls back to a generated default list using 8 template prefixes (`{.agents,.claude,.github,.kiro,~/.agents,~/.claude,~/.copilot,~/.kiro}/{area}`).
- "Show in Marketplace" right-click menu on all area view items (both single-file and multi-file). Uses `revealItemByName()` which searches both skills and area file items in the marketplace tree.
- Green check icon on marketplace items that are installed locally — now works for all content areas, not just skills. Installed names are collected from both the Skills provider and all area providers on every sync.
- Area-specific download: the install command now uses the area-specific default download location (from `AIToolsOrganizer.installLocations`) instead of always using the skills location.
- Installed area scan now includes the configured default download location for each area, ensuring downloaded items are always found even if the location doesn't match a derived scan path.
- Recursive definition file search for multi-file areas: the installed scan now searches recursively for definition files (e.g., `plugin.json`) within item folders, matching how the marketplace discovers items in repos.
- Marketplace View
  - Right-click menus
    - On Skill: "Open in Browser"
    - On Area Group nodes: "Open in Browser"
    - On Single-file items: "Download" (inline + menu), "Open in Browser", inline "View Details"
- Skills View
  - Right-click menus
    - On all item types: "Reveal in File Explorer" (grouped contextually with related actions)

### Changed

- Renamed the Installed view from "Installed" (`AIToolsOrganizer.installed`) to "Skills" (`AIToolsOrganizer.skills`).
- Skill names parsed from `SKILL.md` frontmatter now have surrounding quotes (single or double) stripped.
- Removed `path`, `paths`, and `singleSkill` from `SkillRepository` config. Repositories now only need `owner`, `repo`, and optionally `branch`. Area paths are discovered automatically.
- Simplified `isSameRepository()` to compare only `owner`, `repo`, and `branch`.
- Simplified `parseGitHubUrl()` — no longer extracts path from URLs.
- Simplified Add Repository flow — just provide a GitHub URL; no path prompting.
- "Install Skill" renamed to "Download" across all UI surfaces (command title, detail panel button, progress notifications, messages).
- "View Skill Details" renamed to "View Details".
- Detail panel title now shows the area type (e.g., "Hooks - GitHub: Dependency License Checker" instead of "Skill: ...").
- Detail panel "Raw SKILL.md" tab renamed to "Raw Source".
- Area group nodes in the Marketplace load collapsed by default.
- Hooks - GitHub definition updated to require `hooks.json` (not just `README.md`) as the definition file.
- Hooks split into two separate areas: "Hooks - GitHub" (folder-based with `hooks.json`) and "Hooks - Kiro" (single JSON files). They are mutually exclusive per repository — if GitHub-style hooks are found, Kiro-style discovery is skipped.
- "Reveal in File Explorer" moved to the bottom of all right-click menus (group `9_reveal`), except on installed skill items where it groups with "Show in Marketplace" (group `3_marketplace`).
- "Open Skill Folder" command renamed to "View Installed Item".
- Skills icon redesigned as a 3D package/box (matching the VS Code `package` codicon style) in all 4 status colors.
- Powers area excluded from discovery (still being planned).
- "Install Location" button renamed to "Default Download Location" across all views.
- `AIToolsOrganizer.installLocation` (string) replaced by `AIToolsOrganizer.installLocations` (object with per-area properties). Legacy `installLocation` is no longer used.
- `AIToolsOrganizer.skillRepositories` schema simplified: `additionalProperties` constraint removed so the VS Code Settings UI renders entries inline with editable `owner`, `repo`, and `branch` fields.
- `readRepositoriesConfig()` and `writeRepositoriesConfig()` centralize all config read/write for repositories, supporting both string and object entry formats.
- "Custom..." option in Default Download Location quick pick now opens the VS Code Settings UI filtered to `AIToolsOrganizer.installLocations` instead of opening `settings.json`.
- `refreshAreaProviders()` is now async and properly awaited, fixing timing issues where installed item names were collected before area providers finished refreshing.
- All item-level mutations (delete, move, copy, delete-all) for area items now route through `syncInstalledStatus()`, ensuring the marketplace green check icons update correctly on every change.
- "Show in Marketplace" and "Reveal in File Explorer" now share the same right-click menu group (`3_marketplace`) on area view items, matching the Skills view layout.
- "Open in Browser" on single-file marketplace items moved from group `0_open` to `2_open` to match the Skills right-click menu ordering (Download first, then Open in Browser).
- "Show in Marketplace" (`revealSkillByName`) now correctly expands the matching area group (e.g., Plugins) instead of always expanding the first group (e.g., Agents).
- Activity bar icon redesigned: first two books angled to form the letter "A", third book upright like the letter "I" (for "AI").
- Area provider scan uses mutex-based caching via `loadItems()`: concurrent callers share a single scan promise, and results are cached. `preload()` warms the cache at startup without clearing the loading state. `refresh()` forces a fresh scan.
- `getChildren()` checks `cacheReady` before showing the spinner — if preload already warmed the cache, data renders immediately without a blank flash.

### Known Issues

- Area views may briefly show blank content when first expanded, before the tree data renders. The "Searching for installed {area}..." spinner does not reliably appear. See `.agents/design/areaViewLoading.design.md` for details on attempted solutions.

### Added (continued)

- "Copy to Plugin..." right-click option on installed items in Agents, Skills, Prompts / Commands, and Hooks - GitHub views. Copies the item into a selected plugin's area subfolder (`/agents`, `/skills`, `/commands`, `/hooks`), creating the subfolder if needed.
- Plugin sync commands in the Plugins view:
  - "Get latest copy of AI tools" on plugin items — syncs all area subfolders (agents, skills, commands, hooks) with the latest versions from installed areas.
  - "Get latest copies" on area subfolders within a plugin — syncs all items in that subfolder.
  - "Get latest copy" on individual items within a plugin's area subfolder — syncs a single item.
  - Results shown via output channel with per-item ✅/⏭️ status and failure reasons. Toast notification includes "Show Details" button.
- "Copy to area" right-click option on files and folders inside a plugin's area subfolders. Copies the item to the corresponding installed area's default download location.
- `src/services/pluginSyncService.ts` — shared service for plugin sync operations with `PLUGIN_SUBFOLDER_TO_AREA` mapping, `syncPluginItem()`, and `SyncResult` type with failure reasons.
- "AI Tools Organizer" output channel for detailed sync results.
- Plugin detail panel now shows a third tab for the raw `plugin.json` (or `hooks.json`) content when the definition file is JSON-based.
- Plugin discovery now handles nested category folders (e.g. `plugins/agents/my-plugin/.claude-plugin/plugin.json`) by stripping known wrapper directories (`.claude-plugin`, `.github`) when determining the item root.
- Plugin README.md fallback: when `plugin.json` is nested and README.md isn't found next to it, the detail panel also checks the plugin's root directory.
- Detail panel shows "No README.md found." for JSON-based areas (plugins, hooks) when no body content is available, instead of the generic "No additional details available."
- Code review and implement-fixes agents added to `.github/agents/`.
- `src/test/pluginSync.test.ts` — 13 tests covering single-item sync, folder sync, full plugin sync, copy-from-plugin, and mapping constants.

### Changed (continued)

- "Prompts" view and area label renamed to "Prompts / Commands" to reflect the plugin `commands/` subfolder mapping.
- "Add Repository" button moved back to the Marketplace view navigation bar (from the overflow `...` menu).
- "Copy to Plugin..." excluded from the Plugins view itself (plugins can't be copied into plugins).
- `installSkill` overwrite now uses `useTrash: true` for safety, matching all other delete operations.
- Stale JSDoc on `isSameRepository` and `normalizeRepository` cleaned up (removed references to removed `path` field).
- Unused `serializeRepository` function removed from `types.ts`.
- `parseRepositoryEntry` JSDoc updated to clarify string format is a fallback for manual config entries.
- Redundant SKILL.md file watchers in `extension.ts` removed (covered by `installedProvider.createFileWatchers()`).
- `activate()` function organized with section divider comments (8 sections) for navigability.
- `compareFiles` in `duplicateService.ts` — added comment explaining equal-mtime behavior is intentional when content comparison isn't available.
- `version` bumped to `0.0.5` in `package.json`.
- `uninstall:vsix` script updated from old `formulahendry` publisher to `smaglio81`.
- Area views now scan locations from their own per-area `chat.*` setting (e.g. `chat.agentFilesLocations` for agents, `chat.pluginLocations` for plugins) instead of deriving all scan paths from `chat.agentSkillsLocations`. Falls back to the same generated default list when the setting isn't configured.
- README.md rewritten with concise user-facing content. Detailed guides moved to `docs/` folder (marketplace, installed items, plugins, configuration).

## [0.0.4]

### Changed

- Renamed extension from "Agent Skills" to "AI Tools Organizer". All command IDs, configuration keys, view IDs, and context keys updated from `agentSkills.*` to `AIToolsOrganizer.*`.

### Added

- Colorized skill icons in Marketplace and Installed views using color-coded icons.
- Duplicate skill detection with color-coded icons in the Installed view:
  - Purple — unique skill (only one copy with that name)
  - Green — newest copy among duplicates (based on file content and modification dates)
  - Orange — older copy among duplicates
  - Blue — all copies are identical
- Marketplace View
  - Right-click menus
    - On repositories
      - "Delete" (in addition to the existing inline trash icon)
      - "Open in Browser" — opens the repository on GitHub in the default browser
    - On Skill
      - "Install skill" (in addition to the existing inline install skill icon)
  - Toolbar now includes `AIToolsOrganizer.addRepository` (Add Repository).
    - Users can add a repository by GitHub URL; the extension parses URL forms like `github.com/owner/repo` and `github.com/owner/repo/tree/<branch>/<path>` and writes the parsed entry to `AIToolsOrganizer.skillRepositories`.
    - When a GitHub URL does not include a branch, the extension resolves the repo's default branch via GitHub API before adding the entry.
  - Defaults to collapsed
- Installed Skills View
  - Right-click menus
    - On Skill Folder Locations
      - Delete (and inline trash icon)
    - On Skill
      - "Add File" — creates a new empty file and opens it in the editor.
      - "Add Folder" — creates a new subfolder.
      - "Move to..." - moves a skill folder to a different scan location via QuickPick selector showing current location.
      - "Copy to..." — copies a skill folder to a different scan location, keeping the original in place.
      - "Update older skill copies with latest" - on newest (green) duplicate skills — copies the newest version to all other locations with older copies.
      - "Get latest copy of skill" - on older (orange) duplicate skills — replaces the older copy with the newest version.
      - "Delete" (in addition to the existing inline trash icon).
      - "Show in Marketplace" — reveals and highlights the matching skill in the Marketplace tree view.
    - On Skill Files
      - "Rename" — renames the file within the skill folder.
      - "Delete" — deletes the file (moved to trash).
    - On Skill Folders (subfolders within a skill)
      - "Add File" — creates a new empty file and opens it in the editor.
      - "Add Folder" — creates a new subfolder.
      - "Delete" — deletes the folder and its contents (moved to trash).
  - Toolbar
    - Search - search icon opens an input box to filter skills by name or description. Clear (X) icon appears when a search is active. Location groups with no matching skills are hidden.
    - Expand All / Collapse All buttons
  - Expanded/Collapsed items are remembered between sessions
- When a skill is installed from the marketplace, an `agent-skills-source` frontmatter line injected into `SKILL.md` on install, recording the GitHub source URL (always the last line before the closing `---`).
- File watchers on all scan locations (workspace-relative and home directory) that automatically refresh duplicate status icons when skill files change.
- File watchers are recreated on every refresh and when `chat.agentSkillsLocations` configuration changes, so new location directories are automatically watched.

### Changed

- Repositories that fail to load are now shown in Marketplace with a warning icon and hover tooltip containing the error message.
- Uninstall action renamed to "Delete" in both the inline icon and right-click menu; no longer shows a confirmation prompt.
- Marketplace "Remove Repository" renamed to "Delete" (inline and right-click).
- Add/remove repository operations now update Marketplace incrementally (single-entry add/remove) instead of forcing a full repository list refresh.
- Marketplace now loads repositories progressively: each configured repository appears immediately as a loading entry and is replaced as soon as that repository succeeds or fails.
- Marketplace repository and skill entries are now alphabetically sorted.
- Installed skills in Marketplace now use a green check icon.
- Removing a repository from Marketplace no longer shows a confirmation modal.
- `AIToolsOrganizer.installLocation` no longer enforces a fixed enum of values; any string path is accepted.
- Scan locations for the Installed view are now sourced from the `chat.agentSkillsLocations` setting (maintained by VS Code) instead of being hardcoded. Falls back to the previous default set of six locations if the setting is not configured.
- Installed tree view UX improvements: collapse/expand state persistence, marketplace default collapsed state, split refresh commands.
- Split `AIToolsOrganizer.refresh` into two commands: `AIToolsOrganizer.refresh` (marketplace only) and `AIToolsOrganizer.refreshInstalled` (installed only).
- Installed Skills view initially shows "Loading ..." and then "Searching for installed skills..." with a spinner during the initial scan.

## [0.0.3]

### Added

- Added support for skills directories `~/.copilot/skills` and `~/.claude/skills`.
- Added `github/awesome-copilot` as a default skill repository source.

## [0.0.2]

### Added

- Add Microsoft Docs MCP skills

## [0.0.1]

- Initial release
