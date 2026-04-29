# Configuration

Open VS Code Settings (`Ctrl+,` / `Cmd+,`) and search for "AI Tools Organizer".

## Repositories

**Setting**: `AIToolsOrganizer.skillRepositories`

An array of GitHub repositories to browse in the Marketplace. Each entry has `owner`, `repo`, and `branch` fields. You can edit these directly in the Settings UI or add repositories using the **+** button in the Marketplace toolbar.

![User Settings (JSON) - Skill Repositories](../resources/docs/user-settings-skill-repositories.png)

## Download locations

**Setting**: `AIToolsOrganizer.installLocations`

An object with a download path for each content area. Defaults to `~/.copilot/{area}` for each area. Hooks - Kiro is fixed to `.kiro/hooks`.

You can also change the download location from each view's toolbar using the folder icon button. Selecting "Custom..." opens the Settings UI.

![User Settings - Install Locations](../resources/docs/user-settings-install-locations.png)

### How locations are scanned

Each area view checks its own `chat.*` setting for scan locations. These settings contain a map of paths to enabled/disabled values — paths set to `false` are skipped, and any other value is treated as enabled and scanned. If the setting isn't configured or has no enabled paths, a default list is generated from template prefixes.

| Area | Setting checked |
|---|---|
| Agents | `chat.agentFilesLocations` |
| Hooks - GitHub | `chat.hookFilesLocations` |
| Hooks - Kiro | Fixed to `.kiro/hooks` |
| Instructions | `chat.instructionsFilesLocations` |
| Plugins | `chat.pluginLocations` |
| Prompts / Commands | `chat.promptFilesLocations` |
| Skills | `chat.agentSkillsLocations` |

**Example**: If `chat.agentFilesLocations` is set to `{ "~/.copilot/agents": true, ".github/agents": false }`, only `~/.copilot/agents` will be scanned. The `.github/agents` location is disabled.

When the setting isn't configured, these default locations are scanned:

| Scope | Locations |
|---|---|
| Workspace | `.agents/{area}`, `.claude/{area}`, `.github/{area}`, `.kiro/{area}` |
| Home | `~/.agents/{area}`, `~/.claude/{area}`, `~/.copilot/{area}`, `~/.kiro/{area}` |

The configured download location from `AIToolsOrganizer.installLocations` is also always included in the scan.

## GitHub token

**Setting**: `AIToolsOrganizer.githubToken`

Optional. Provides higher GitHub API rate limits when browsing many repositories. Create a token at [GitHub Settings](https://github.com/settings/tokens) with `public_repo` scope.

## Cache timeout

**Setting**: `AIToolsOrganizer.cacheTimeout`

How long (in seconds) to cache marketplace data. Default: 3600 (1 hour). Click Refresh in the Marketplace toolbar to bypass the cache.
