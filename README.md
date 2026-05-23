# AI Tools Organizer

Browse, download, and manage AI tools from **GitHub** and **Azure DevOps** (`dev.azure.com`) — agents, skills, hooks, instructions, Cursor-style plugins and marketplaces, rules, and prompts — all from a single sidebar in **VS Code** or **Cursor**.

## What it does

AI Tools Organizer adds a sidebar panel with views for each type of AI tool:

- **Marketplace** — discover content from configured GitHub and Azure DevOps repositories, including repos that publish a **Cursor plugin index** via `.cursor-plugin/marketplace.json`
- **Skills** — folders with `SKILL.md`
- **Agents** — `*.agent.md` (and other agent file layouts Cursor accepts)
- **Hooks - GitHub** — folder-based hooks with `hooks.json`
- **Hooks - Kiro** — single-file JSON hooks
- **Instructions** — `*.instructions.md` files
- **Plugins** — folders with `plugin.json` at the root **or** under `.cursor-plugin/plugin.json` (Cursor’s canonical manifest location)
- **Rules** — `.mdc` / `.md` rule files (often under `.cursor/rules`)
- **Prompts / Commands** — `*.prompt.md` and related command file types

Each view shows what you have installed locally, grouped by location. The Marketplace lets you browse repositories and download items with one click.

The extension scans conventional paths under your workspace and home directory, including **`.cursor/{area}`** (for example `.cursor/skills`, `.cursor/plugins`) alongside `.agents`, `.claude`, `.github`, `.copilot`, and `.kiro` layouts. Default download targets use **`~/.cursor/plugins/local`** for plugins and **`~/.cursor/rules`** for rules when you have not chosen another location; other areas default under `~/.copilot/…` unless you change them in settings.

![AI Tools Organizer](resources/ai-tools-organizer.png)

## Getting started

1. Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=smaglio81.agent-organizer) (works in Cursor as well)
2. Open the **AI Tools Organizer** panel in the Activity Bar
3. Expand the **Marketplace** view — `github/awesome-copilot` is pre-configured so content loads automatically
4. Browse and click the download button on any item
5. Your downloaded items appear in the corresponding area view

## Key features

**Create from scratch** — use the "Add" button in any view's toolbar to scaffold a new item with the right file structure for that area.

**Rename and copy name** — right-click any item to rename it (updates the folder/file and definition file) or copy its name to the clipboard. **Duplicate** creates a copy with a new name in the same location.

**Copy #{path} for chat** — right-click an installed item, folder, or file and choose **Copy #{path}** to copy a chat-ready reference you can paste into conversation prompts. **Copy Absolute Path** is also available for the full filesystem path.

**Download from GitHub or Azure DevOps** — browse multiple repositories, view README documentation, and download any item to your configured location. Paste a repo URL from GitHub or `https://dev.azure.com/{org}/{project}/_git/{repo}` to add it to the Marketplace; use a [Personal Access Token](docs/configuration.md#azure-devops-token) for private Azure DevOps projects.

**Cursor plugins and marketplaces** — detects per-plugin manifests at `plugin.json` or `.cursor-plugin/plugin.json`, and can expand multi-plugin catalogs described by `.cursor-plugin/marketplace.json`.

**Duplicate detection** — when the same item exists in multiple locations, color-coded icons show which copy is newest (green), older (orange), identical (blue), or unique (purple).

**Plugin sync** — keep plugin subfolders (`/agents`, `/skills`, `/commands`, `/hooks`) in sync with your latest installed items. Use "Get latest copy" to pull updates into a plugin, or "Update Plugins" to push changes out to all plugins that contain a copy.

**More reliable delete behavior** — delete actions are now more resilient on Windows and linked-folder setups, so item cleanup continues to work even when the OS trash flow is unavailable.

**Flexible locations** — each area has its own configurable download location. Scans workspace folders and home directories automatically, including `.cursor`-based paths. Locations marked as disabled in your `chat.*` settings are skipped (the configured download location is always included regardless; falls back to defaults if no enabled paths remain).

**Green check indicators** — items you've already downloaded show a green check in the Marketplace.

For detailed guides, see the [docs](docs/) folder:

- [Marketplace & downloading](docs/marketplace.md)
- [Managing installed items](docs/installed-items.md)
- [Plugin workflows](docs/plugins.md)
- [Configuration](docs/configuration.md)

Add **GitHub** or **Azure DevOps** repositories from the Marketplace toolbar (paste the clone or web URL) or in Settings. For Azure DevOps, each entry needs `owner` (organization), `project`, `repo`, and `branch` — see [Configuration](docs/configuration.md#repositories).

## For Skill Developers

To create skills compatible with this extension:

1. **Follow the SKILL.md specification** with proper YAML frontmatter
2. **Store skills in a public GitHub repository** or a public **Azure DevOps** Git repo that allows anonymous read, or ensure consumers configure a PAT for private orgs
3. **Organize skills** in a directory structure with one skill per folder
4. **Document thoroughly** with clear README and usage examples
5. **Include metadata** (license, compatibility, description)

Users can then discover and install your skills through this marketplace!

## Learning More

- [Agent Skills Specification](https://agentskills.io)
- [VS Code Extension Documentation](https://code.visualstudio.com/api)
- [GitHub REST API](https://docs.github.com/en/rest)
- [Azure DevOps REST API](https://learn.microsoft.com/en-us/rest/api/azure/devops/)

## Issues & Feedback

Found a bug or have a feature request? [Open an issue on GitHub](https://github.com/smaglio81/ai-tools-organizer/issues).

## License

MIT License - see [LICENSE](LICENSE) file for details

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues.

### Development Setup

1. Clone the repository
2. Run `npm install` to install dependencies
3. Run `npm run watch` to start the development watcher
4. Press `F5` in VS Code to launch the extension in debug mode

### Building

```bash
npm run compile    # Compile with type checking and linting
npm run package    # Build production bundle
```

## Credits

Based on the original work from [formulahendry/vscode-agent-skills](https://github.com/formulahendry/vscode-agent-skills).

---

Made with ❤️ for AI and Agent enthusiasts
