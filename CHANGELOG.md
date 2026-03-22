# Change Log

All notable changes to the "agent-skills" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.4]

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
  - Toolbar now includes `agentSkills.addRepository` (Add Repository).
    - Users can add a repository by GitHub URL; the extension parses URL forms like `github.com/owner/repo` and `github.com/owner/repo/tree/<branch>/<path>` and writes the parsed entry to `agentSkills.skillRepositories`.
    - When a GitHub URL does not include a branch, the extension resolves the repo's default branch via GitHub API before adding the entry.
  - Defaults to collapsed
- Installed Skills View
  - Right-click menus
    - On Skill Folder Locations
      - Delete (and inline trash icon)
    - On Skill
      - "Move to..." - moves a skill folder to a different scan location via QuickPick selector showing current location.
      - "Copy to..." — copies a skill folder to a different scan location, keeping the original in place.
      - "Update older skill copies with latest" - on newest (green) duplicate skills — copies the newest version to all other locations with older copies.
      - "Get latest copy of skill" - on older (orange) duplicate skills — replaces the older copy with the newest version.
      - "Delete" (in addition to the existing inline trash icon).
      - "Show in Marketplace" — reveals and highlights the matching skill in the Marketplace tree view.
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
- `agentSkills.installLocation` no longer enforces a fixed enum of values; any string path is accepted.
- Scan locations for the Installed view are now sourced from the `chat.agentSkillsLocations` setting (maintained by VS Code) instead of being hardcoded. Falls back to the previous default set of six locations if the setting is not configured.
- Installed tree view UX improvements: collapse/expand state persistence, marketplace default collapsed state, split refresh commands.
- Split `agentSkills.refresh` into two commands: `agentSkills.refresh` (marketplace only) and `agentSkills.refreshInstalled` (installed only).

## [0.0.3]

### Added

- Added support for skills directories `~/.copilot/skills` and `~/.claude/skills`.
- Added `github/awesome-copilot` as a default skill repository source.

## [0.0.2]

### Added

- Add Microsoft Docs MCP skills

## [0.0.1]

- Initial release
