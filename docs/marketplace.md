# Marketplace & Downloading

The Marketplace view lets you browse AI tools from configured GitHub repositories.

## Browsing

Content is organized by repository, then by area type. Each repository shows its available areas (Agents, Skills, Plugins, etc.) with item counts.

Click any item to view its details in a panel with:
- Rendered README documentation
- Raw source content
- For plugins: the raw `plugin.json` definition
- Download and View Source buttons

&nbsp;
![Marketplace](../resources/docs/agent-organizer-marketplace.png)

## Downloading

**Multi-file items** (skills, plugins, hooks): click the download button to copy the entire folder to your configured download location.

**Single-file items** (agents, instructions, prompts): click the download button to save the file to the area's download location. Subfolder structure from the repository is preserved.

Downloaded items appear in the corresponding area view and get a green check in the Marketplace.

## Adding repositories

Click the **+** button in the Marketplace toolbar and paste a GitHub URL. The extension parses the URL and resolves the default branch automatically.

You can also add repositories in Settings under `agentOrganizer.skillRepositories`.

## Searching

Use the search icon in any view's toolbar to filter items by name or description. The clear button (✕) resets the filter.

## Right-click options

| Item type | Options |
|---|---|
| Repository | Delete, Open in Browser |
| Area group | Open in Browser |
| Multi-file item | Download, View Details, Open in Browser |
| Single-file item | Download, View Details, Open in Browser |
