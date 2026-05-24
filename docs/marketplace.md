# Marketplace & Downloading

The Marketplace view lets you browse AI tools from configured GitHub or Azure DevOps repositories.

## Browsing

Content is organized by repository, then by area type. Each repository shows its available areas (Agents, Skills, Plugins, etc.) with item counts.

Click any item to view its details in a panel with:
- Rendered README documentation
- Raw source content
- For plugins: the raw `plugin.json` definition
- Download and View Source buttons

&nbsp;
![Marketplace](../resources/docs/ai-tools-organizer-marketplace.png)

## Downloading

**Multi-file items** (skills, plugins, hooks): click the download button to copy the entire folder to your configured download location.

**Single-file items** (agents, instructions, prompts): click the download button to save the file to the area's download location. Subfolder structure from the repository is preserved.

Downloaded items appear in the corresponding area view and get a green check in the Marketplace.

## Default repository

`github/awesome-copilot` is pre-configured as the default marketplace source for new installs. The Marketplace loads its content automatically the first time you open the panel.

## Adding repositories

Click the **+** button in the Marketplace toolbar and paste a GitHub or Azure DevOps URL. The extension parses the URL and resolves the default branch automatically.

Supported URL formats:
- **GitHub**: `https://github.com/owner/repo` or `https://github.com/owner/repo/tree/branch`
- **Azure DevOps**: `https://dev.azure.com/org/project/_git/repo`

You can also add repositories in Settings under `AIToolsOrganizer.skillRepositories`. For Azure DevOps repositories, set the `project` field in addition to `owner`, `repo`, and `branch`.

## How repository scanning works

To avoid loading the entire file tree of large repositories, the extension uses a scoped two-phase approach:

1. **Root listing** — one non-recursive API call retrieves the top-level entries.
2. **Targeted subtree fetches** — only directories that match a known allowlist are recursively fetched. The allowlist includes:
   - Dot-tooling roots: `.cursor`, `.claude`, `.cursor-plugin`, `.github`, `.kiro`
   - Conventional area directory names: `skills`, `agents`, `hooks`, `rules`, `instructions`, `plugins`, `prompts`
3. **Marketplace augmentation** — if `.cursor-plugin/marketplace.json` is present, each declared plugin directory is also fetched.

Directories such as `node_modules`, `docs`, or any other unrecognised folder are **never** recursed into. This keeps loading fast even for large monorepos where only a small subset of the tree contains AI tools.

## Searching

Use the search icon in any view's toolbar to filter items by name or description. The clear button (✕) resets the filter.

## Right-click options

| Item type | Options |
|---|---|
| Repository | Delete, Open in Browser |
| Area group | Open in Browser |
| Multi-file item | Download, View Details, Open in Browser |
| Single-file item | Download, View Details, Open in Browser |
