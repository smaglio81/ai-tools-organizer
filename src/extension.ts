/**
 * Agent Organizer VS Code Extension
 * Provides a marketplace for browsing, installing, and managing Agent Organizer
 */

import * as vscode from 'vscode';
import { GitHubSkillsClient } from './github/skillsClient';
import { MarketplaceTreeDataProvider, SkillTreeItem, SourceTreeItem, FailedSourceTreeItem, SkillsGroupTreeItem, AreaGroupTreeItem, AreaFileTreeItem } from './views/marketplaceProvider';
import { InstalledSkillsTreeDataProvider, InstalledSkillTreeItem, LocationTreeItem, SkillFolderTreeItem, SkillFileTreeItem } from './views/installedProvider';
import { InstalledAreaTreeDataProvider, AreaInstalledItemTreeItem, AreaLocationTreeItem, AreaItemFolderTreeItem, AreaItemFileTreeItem, initializeAreaIcons } from './views/installedAreaProvider';
import { SkillDetailPanel } from './views/skillDetailPanel';
import { SkillInstallationService } from './services/installationService';
import { SkillPathService } from './services/skillPathService';
import { Skill, InstalledSkill, SkillRepository, isSameRepository, normalizeSeparators, buildGitHubUrl, readRepositoriesConfig, writeRepositoriesConfig, AreaFileItem, ContentArea, AREA_DEFINITIONS } from './types';
import { PLUGIN_SUBFOLDER_TO_AREA, PLUGIN_AREA_SUBFOLDERS, AREA_TO_PLUGIN_SUBFOLDER, resolveInstalledItemUri, syncPluginItem } from './services/pluginSyncService';

/**
 * Validate a file or folder name: non-empty, no path separators, no traversal.
 */
function validateItemName(value: string | undefined, label: string): string | undefined {
    if (!value?.trim()) { return `${label} is required`; }
    if (/[/\\]/.test(value)) { return `${label} cannot contain path separators`; }
    // Block . and .. to prevent path traversal via Uri.joinPath
    if (value.trim() === '.' || value.trim() === '..') { return `${label} cannot be '.' or '..'`; }
    // Block names containing .. segments (e.g. "..foo", "a..b") that could normalize to traversal
    if (/\.\./.test(value.trim())) { return `${label} cannot contain '..'`; }
    return undefined;
}

/**
 * Recursively search for a file by name within a directory.
 * Returns the URI of the first match, or undefined if not found.
 */
async function findDefinitionFile(dirUri: vscode.Uri, fileName: string): Promise<vscode.Uri | undefined> {
    const fs = vscode.workspace.fs;
    const rootFile = vscode.Uri.joinPath(dirUri, fileName);
    try {
        await fs.stat(rootFile);
        return rootFile;
    } catch { /* not at root */ }

    try {
        const entries = await fs.readDirectory(dirUri);
        for (const [name, type] of entries) {
            if (type === vscode.FileType.Directory) {
                const found = await findDefinitionFile(vscode.Uri.joinPath(dirUri, name), fileName);
                if (found) { return found; }
            }
        }
    } catch { /* ignore */ }
    return undefined;
}

/**
 * Resolve the parent URI from a skill or folder tree item.
 */
function resolveParentUri(item: InstalledSkillTreeItem | SkillFolderTreeItem | AreaInstalledItemTreeItem | AreaItemFolderTreeItem): vscode.Uri {
    if (item instanceof InstalledSkillTreeItem) { return item.skillUri; }
    if (item instanceof SkillFolderTreeItem) { return item.folderUri; }
    if (item instanceof AreaInstalledItemTreeItem) { return item.itemUri; }
    return item.folderUri;
}

/**
 * Parse a GitHub URL into its SkillRepository components.
 * Handles these forms:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/branch
 *   https://github.com/owner/repo/tree/branch/path/to/skills
 *
 * Returns undefined when the input cannot be parsed as a GitHub URL.
 * `path` is undefined when it was not encoded in the URL (caller should prompt).
 * `branch` is undefined when it was not encoded in the URL (caller should resolve via API).
 */
export function parseGitHubUrl(input: string): { owner: string; repo: string; branch: string | undefined } | undefined {
    // Strip protocol, www prefix, query string, and fragment
    const normalized = input.trim()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/[?#].*$/, '');

    if (!normalized.startsWith('github.com/')) {
        return undefined;
    }

    const parts = normalized.slice('github.com/'.length).split('/').filter(p => p.length > 0);
    if (parts.length < 2) {
        return undefined;
    }

    const owner = parts[0];
    // Strip trailing .git suffix from repo name
    const repo = parts[1].replace(/\.git$/, '');

    if (parts.length === 2) {
        return { owner, repo, branch: undefined };
    }

    // Only accept /tree/<branch>[/<path...>] beyond owner/repo
    if (parts[2] !== 'tree' || parts.length < 4) {
        return undefined;
    }

    const branch = parts[3];
    return { owner, repo, branch };
}

/**
 * Normalize a user-provided name for use as a file/folder name:
 * lowercase, non-alphanumeric → dashes, collapse multiple dashes.
 */
export function normalizeName(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Get today's date in yyyy.MM.dd format.
 */
export function todayStamp(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}.${mm}.${dd}`;
}

/**
 * Update the `name` field in a YAML frontmatter file (e.g. SKILL.md, *.agent.md).
 * Replaces the first `name: ...` line in the frontmatter block.
 */
async function updateFrontmatterName(fileUri: vscode.Uri, newName: string): Promise<void> {
    const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(fileUri));
    if (!raw.startsWith('---')) { return; }
    const endIdx = raw.indexOf('---', 3);
    if (endIdx < 0) { return; }
    const frontmatter = raw.substring(0, endIdx + 3);
    const updated = frontmatter.replace(/^(name:\s*).+$/m, `$1${newName}`);
    if (updated === frontmatter) { return; }
    const result = updated + raw.substring(endIdx + 3);
    await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(result));
}

/**
 * Update the `name` field in a JSON definition file (e.g. plugin.json, hooks.json).
 */
async function updateJsonDefinitionName(fileUri: vscode.Uri, newName: string): Promise<void> {
    const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(fileUri));
    try {
        const obj = JSON.parse(raw);
        if (typeof obj.name === 'string') {
            obj.name = newName;
            await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(JSON.stringify(obj, null, 2) + '\n'));
        }
    } catch { /* not valid JSON, skip */ }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Agent Organizer extension is now active!');

    // ─── Section 1: Service initialization ───────────────────────────────
    const githubClient = new GitHubSkillsClient(context);
    const pathService = new SkillPathService();
    const installationService = new SkillInstallationService(githubClient, context, pathService);
    const outputChannel = vscode.window.createOutputChannel('Agent Organizer');
    context.subscriptions.push(outputChannel);

    // ─── Section 2: View provider initialization ──────────────────────────
    const marketplaceProvider = new MarketplaceTreeDataProvider(githubClient, context);
    const installedProvider = new InstalledSkillsTreeDataProvider(context, pathService);
    initializeAreaIcons(context);

    // Create area view providers (excluding skills which has its own dedicated provider, and powers which is still planned)
    const areaViewIds: { area: ContentArea; viewId: string }[] = [
        { area: 'agents', viewId: 'agentOrganizer.agents' },
        { area: 'hooksGithub', viewId: 'agentOrganizer.hooksGithub' },
        { area: 'hooksKiro', viewId: 'agentOrganizer.hooksKiro' },
        { area: 'instructions', viewId: 'agentOrganizer.instructions' },
        { area: 'plugins', viewId: 'agentOrganizer.plugins' },
        { area: 'prompts', viewId: 'agentOrganizer.prompts' },
    ];

    const areaProviders = new Map<string, InstalledAreaTreeDataProvider>();
    const areaTreeViews: vscode.Disposable[] = [];

    // ─── Section 3: Helper functions (move/copy/download location) ─────
    // These closures capture pathService, areaProviders, areaViewIds, etc.

    /** Refresh all area providers */
    async function refreshAreaProviders(): Promise<void> {
        await Promise.all(
            Array.from(areaProviders.values()).map(p => p.refresh())
        );
    }

    /** Write sync results to the output channel and show a toast with optional "Show Details" button. */
    async function showSyncResults(
        title: string,
        toastMessage: string,
        results: { label: string; updated: boolean; reason?: string }[]
    ): Promise<void> {
        const updated = results.filter(r => r.updated).length;
        outputChannel.appendLine('');
        outputChannel.appendLine(`── ${title} ──`);
        outputChannel.appendLine(`Updated ${updated} of ${results.length} item(s)\n`);
        for (const r of results) {
            const status = r.updated ? '✅' : (r.reason ? '❌' : '⏭️');
            const note = !r.updated && r.reason ? ` — ${r.reason}` : '';
            outputChannel.appendLine(`  ${status} ${r.label}${note}`);
        }
        const action = await vscode.window.showInformationMessage(toastMessage, 'Show Details');
        if (action === 'Show Details') { outputChannel.show(); }
    }

    /** Move or copy an area item to a different scan location */
    async function moveOrCopyAreaItem(item: AreaInstalledItemTreeItem, mode: 'move' | 'copy'): Promise<void> {
        const def = AREA_DEFINITIONS[item.area];
        const conventionalDir = def.conventionalDir || item.area;
        const locations = pathService.getScanLocations();

        // Build area-specific locations
        const areaLocations = locations.map(loc => {
            const lastSlash = normalizeSeparators(loc).lastIndexOf('/');
            return lastSlash > 0 ? loc.substring(0, lastSlash) + '/' + conventionalDir : conventionalDir;
        });

        // Determine current location
        const itemLoc = normalizeSeparators(item.installedItem.location);
        const currentParent = itemLoc.includes('/') ? itemLoc.substring(0, itemLoc.lastIndexOf('/')) : itemLoc;

        const picks = [...new Set(areaLocations)].map(loc => ({
            label: loc,
            description: normalizeSeparators(loc) === currentParent ? '(current)' : undefined
        }));

        const picked = await vscode.window.showQuickPick(picks, {
            placeHolder: `${mode === 'move' ? 'Move' : 'Copy'} to...`,
            title: item.installedItem.name
        });
        if (!picked || normalizeSeparators(picked.label) === currentParent) { return; }

        const targetWorkspaceFolder = pathService.getWorkspaceFolderForLocation(picked.label);
        const targetDir = pathService.resolveLocationToUri(picked.label, targetWorkspaceFolder);
        if (!targetDir) {
            vscode.window.showErrorMessage('Failed to resolve target location.');
            return;
        }

        const itemName = itemLoc.substring(itemLoc.lastIndexOf('/') + 1);
        const targetUri = vscode.Uri.joinPath(targetDir, itemName);

        try {
            await vscode.workspace.fs.createDirectory(targetDir);
            await vscode.workspace.fs.copy(item.itemUri, targetUri, { overwrite: false });
            if (mode === 'move') {
                await vscode.workspace.fs.delete(item.itemUri, { recursive: true, useTrash: true });
            }
            vscode.window.showInformationMessage(`Successfully ${mode === 'move' ? 'moved' : 'copied'} "${item.installedItem.name}"`);
            await syncInstalledStatus();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to ${mode}: ${message}`);
        }
    }

    /** Move or copy all items in an area location to a different location */
    async function moveOrCopyAreaLocation(locationItem: AreaLocationTreeItem, mode: 'move' | 'copy'): Promise<void> {
        if (locationItem.items.length === 0) { return; }

        const firstItem = locationItem.items[0];
        const firstLoc = normalizeSeparators(firstItem.location);
        const parentLoc = firstLoc.includes('/') ? firstLoc.substring(0, firstLoc.lastIndexOf('/')) : firstLoc;

        let targetArea: ContentArea | undefined;
        for (const { area, viewId } of areaViewIds) {
            const provider = areaProviders.get(viewId);
            if (provider && provider.getInstalledItems().some(i => normalizeSeparators(i.location).startsWith(parentLoc))) {
                targetArea = area;
                break;
            }
        }
        if (!targetArea) { return; }

        const def = AREA_DEFINITIONS[targetArea];
        const conventionalDir = def.conventionalDir || targetArea;
        const locations = pathService.getScanLocations();
        const areaLocations = [...new Set(locations.map(loc => {
            const lastSlash = normalizeSeparators(loc).lastIndexOf('/');
            return lastSlash > 0 ? loc.substring(0, lastSlash) + '/' + conventionalDir : conventionalDir;
        }))];

        const picks = areaLocations.map(loc => ({
            label: loc,
            description: normalizeSeparators(loc) === parentLoc ? '(current)' : undefined
        }));

        const picked = await vscode.window.showQuickPick(picks, {
            placeHolder: `${mode === 'move' ? 'Move' : 'Copy'} all items to...`,
            title: locationItem.location
        });
        if (!picked || normalizeSeparators(picked.label) === parentLoc) { return; }

        const targetWorkspaceFolder = pathService.getWorkspaceFolderForLocation(picked.label);
        const targetDir = pathService.resolveLocationToUri(picked.label, targetWorkspaceFolder);
        if (!targetDir) {
            vscode.window.showErrorMessage('Failed to resolve target location.');
            return;
        }

        try {
            await vscode.workspace.fs.createDirectory(targetDir);
            for (const areaItem of locationItem.items) {
                const loc = normalizeSeparators(areaItem.location);
                const itemName = loc.substring(loc.lastIndexOf('/') + 1);
                const sourceWorkspaceFolder = pathService.getWorkspaceFolderForLocation(parentLoc);
                const sourceDir = pathService.resolveLocationToUri(parentLoc, sourceWorkspaceFolder);
                if (!sourceDir) { continue; }
                const sourceUri = vscode.Uri.joinPath(sourceDir, itemName);
                const targetUri = vscode.Uri.joinPath(targetDir, itemName);
                await vscode.workspace.fs.copy(sourceUri, targetUri, { overwrite: false });
                if (mode === 'move') {
                    await vscode.workspace.fs.delete(sourceUri, { recursive: true, useTrash: true });
                }
            }
            vscode.window.showInformationMessage(`Successfully ${mode === 'move' ? 'moved' : 'copied'} ${locationItem.items.length} item(s)`);
            await syncInstalledStatus();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to ${mode}: ${message}`);
        }
    }

    /** Move or copy all skills in a Skills view location to a different location */
    async function moveOrCopySkillLocation(locationItem: LocationTreeItem, mode: 'move' | 'copy'): Promise<void> {
        if (locationItem.skills.length === 0) { return; }

        const locations = pathService.getScanLocations();
        const currentLoc = normalizeSeparators(locationItem.location);

        const picks = locations.map(loc => ({
            label: loc,
            description: normalizeSeparators(loc) === currentLoc ? '(current)' : undefined
        }));

        const picked = await vscode.window.showQuickPick(picks, {
            placeHolder: `${mode === 'move' ? 'Move' : 'Copy'} all skills to...`,
            title: locationItem.location
        });
        if (!picked || normalizeSeparators(picked.label) === currentLoc) { return; }

        const targetWorkspaceFolder = pathService.getWorkspaceFolderForLocation(picked.label);
        const targetDir = pathService.resolveLocationToUri(picked.label, targetWorkspaceFolder);
        if (!targetDir) {
            vscode.window.showErrorMessage('Failed to resolve target location.');
            return;
        }

        try {
            await vscode.workspace.fs.createDirectory(targetDir);
            const sourceWorkspaceFolder = pathService.getWorkspaceFolderForLocation(currentLoc);
            const sourceDir = pathService.resolveLocationToUri(currentLoc, sourceWorkspaceFolder);
            if (!sourceDir) { return; }

            for (const skill of locationItem.skills) {
                const skillName = normalizeSeparators(skill.location).split('/').pop() || skill.name;
                const sourceUri = vscode.Uri.joinPath(sourceDir, skillName);
                const targetUri = vscode.Uri.joinPath(targetDir, skillName);
                await vscode.workspace.fs.copy(sourceUri, targetUri, { overwrite: false });
                if (mode === 'move') {
                    await vscode.workspace.fs.delete(sourceUri, { recursive: true, useTrash: true });
                }
            }
            vscode.window.showInformationMessage(`Successfully ${mode === 'move' ? 'moved' : 'copied'} ${locationItem.skills.length} skill(s)`);
            await syncInstalledStatus();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to ${mode}: ${message}`);
        }
    }

    /** Generic handler for selecting the default download location for any area */
    async function selectDefaultDownloadLocation(area: ContentArea): Promise<void> {
        const areaLabel = AREA_DEFINITIONS[area].label;
        const currentValue = pathService.getDefaultDownloadLocation(area);
        const possibleLocations = pathService.getDefaultDownloadLocations(area);
        const normalizedCurrent = normalizeSeparators(currentValue);

        // hooksKiro is fixed — show info and return
        if (area === 'hooksKiro') {
            vscode.window.showInformationMessage(`Hooks - Kiro can only be stored in .kiro/hooks`);
            return;
        }

        // Build quick pick items
        const items: vscode.QuickPickItem[] = [];
        for (const loc of possibleLocations) {
            items.push({
                label: loc,
                description: normalizeSeparators(loc) === normalizedCurrent ? '(current)' : undefined
            });
        }

        // Add current value if not already in the list
        if (!possibleLocations.some(v => normalizeSeparators(v) === normalizedCurrent)) {
            items.unshift({
                label: currentValue,
                description: '(current)'
            });
        }

        // Add Custom option
        items.push({
            label: 'Custom...',
            description: 'Edit in User Settings'
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Select default download location for ${areaLabel}`
        });

        if (!selected) { return; }

        if (selected.label === 'Custom...') {
            // Open the Settings UI filtered to the installLocations setting
            await vscode.commands.executeCommand('workbench.action.openSettings', 'agentOrganizer.installLocations');
        } else {
            await pathService.setDefaultDownloadLocation(area, selected.label);
            // Refresh the relevant provider
            if (area === 'skills') {
                await installedProvider.refresh();
            } else {
                const viewId = areaViewIds.find(a => a.area === area)?.viewId;
                if (viewId) { areaProviders.get(viewId)?.refresh(); }
            }
        }
    }

    /**
     * Create a new area item at the given location URI.
     * @param area The content area type
     * @param name The normalized item name
     * @param locationUri The parent directory URI where the item will be created
     */
    async function createNewAreaItem(area: ContentArea, name: string, locationUri: vscode.Uri): Promise<void> {
        await vscode.workspace.fs.createDirectory(locationUri);

        switch (area) {
            case 'skills': {
                const folderUri = vscode.Uri.joinPath(locationUri, name);
                await vscode.workspace.fs.createDirectory(folderUri);
                const skillMd = `---\nname: ${name}\ndescription: \nmetadata:\n  version: "${todayStamp()}"\n---\n`;
                const fileUri = vscode.Uri.joinPath(folderUri, 'SKILL.md');
                await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(skillMd));
                await vscode.commands.executeCommand('vscode.open', fileUri);
                break;
            }
            case 'agents': {
                const fileUri = vscode.Uri.joinPath(locationUri, `${name}.agent.md`);
                const content = `---\nname: ${name}\ndescription: \n---\n`;
                await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(content));
                await vscode.commands.executeCommand('vscode.open', fileUri);
                break;
            }
            case 'hooksGithub': {
                const folderUri = vscode.Uri.joinPath(locationUri, name);
                await vscode.workspace.fs.createDirectory(folderUri);
                // README.md with frontmatter
                const readmeMd = `---\nname: ${name}\ndescription: \ntags: []\nmetadata:\n  version: "${todayStamp()}"\n---\n`;
                await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folderUri, 'README.md'), new TextEncoder().encode(readmeMd));
                // hooks.json
                const hooksJson = JSON.stringify({ version: 1, hooks: {} }, null, 2) + '\n';
                const hooksFileUri = vscode.Uri.joinPath(folderUri, `${name}.hooks.json`);
                await vscode.workspace.fs.writeFile(hooksFileUri, new TextEncoder().encode(hooksJson));
                await vscode.commands.executeCommand('vscode.open', hooksFileUri);
                break;
            }
            case 'hooksKiro': {
                const folderUri = vscode.Uri.joinPath(locationUri, name);
                await vscode.workspace.fs.createDirectory(folderUri);
                // README.md with frontmatter
                const readmeMd = `---\nname: ${name}\ndescription: \ntags: []\nmetadata:\n  version: "${todayStamp()}"\n---\n`;
                await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folderUri, 'README.md'), new TextEncoder().encode(readmeMd));
                // hooks.json
                const hooksJson = JSON.stringify({ version: 1, hooks: {} }, null, 2) + '\n';
                const hooksFileUri = vscode.Uri.joinPath(folderUri, `${name}.hooks.json`);
                await vscode.workspace.fs.writeFile(hooksFileUri, new TextEncoder().encode(hooksJson));
                await vscode.commands.executeCommand('vscode.open', hooksFileUri);
                break;
            }
            case 'instructions': {
                const fileUri = vscode.Uri.joinPath(locationUri, `${name}.instructions.md`);
                const content = `---\nname: ${name}\ndescription: \n---\n`;
                await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(content));
                await vscode.commands.executeCommand('vscode.open', fileUri);
                break;
            }
            case 'plugins': {
                const folderUri = vscode.Uri.joinPath(locationUri, name);
                await vscode.workspace.fs.createDirectory(folderUri);
                // README.md
                const readmeMd = `---\nname: ${name}\ndescription: \nmetadata:\n  version: "${todayStamp()}"\n---\n`;
                const readmeUri = vscode.Uri.joinPath(folderUri, 'README.md');
                await vscode.workspace.fs.writeFile(readmeUri, new TextEncoder().encode(readmeMd));
                // plugin.json
                const pluginJson = JSON.stringify({
                    name,
                    description: '',
                    version: '0.1.0',
                    agents: 'agents/',
                    skills: 'skills/',
                    hooks: 'hooks/',
                    mcpServers: '.mcp.json'
                }, null, 2) + '\n';
                await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folderUri, 'plugin.json'), new TextEncoder().encode(pluginJson));
                // .mcp.json
                const mcpJson = JSON.stringify({ mcpServers: {} }, null, 2) + '\n';
                await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folderUri, '.mcp.json'), new TextEncoder().encode(mcpJson));
                // .claude-plugin/plugin.json symlink — VS Code FS API doesn't support symlinks,
                // so create a copy with a comment noting it mirrors the root plugin.json
                const claudePluginDir = vscode.Uri.joinPath(folderUri, '.claude-plugin');
                await vscode.workspace.fs.createDirectory(claudePluginDir);
                await vscode.workspace.fs.copy(vscode.Uri.joinPath(folderUri, 'plugin.json'), vscode.Uri.joinPath(claudePluginDir, 'plugin.json'));
                await vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(folderUri, 'plugin.json'));
                break;
            }
            case 'prompts': {
                const fileUri = vscode.Uri.joinPath(locationUri, `${name}.prompt.md`);
                const content = `---\nname: ${name}\ndescription: \n---\n`;
                await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(content));
                await vscode.commands.executeCommand('vscode.open', fileUri);
                break;
            }
        }
    }

    /**
     * Validate a custom location path: must be relative or start with ~, no .., no absolute paths.
     */
    function validateCustomLocation(value: string | undefined): string | undefined {
        if (!value?.trim()) { return 'Location is required'; }
        const v = value.trim();
        // Must be relative or start with ~
        if (/^[a-zA-Z]:/.test(v) || (v.startsWith('/') && !v.startsWith('~'))) { return 'Only relative paths or paths starting with ~ are allowed'; }
        if (v.includes('..')) { return 'Path cannot contain ".."'; }
        if (/[<>"|?*]/.test(v)) { return 'Path contains invalid characters'; }
        return undefined;
    }

    /**
     * Prompt for a name, normalize it, and create a new area item.
     * @param area The content area
     * @param locationUri The parent directory URI
     */
    async function promptAndCreateItem(area: ContentArea, locationUri: vscode.Uri): Promise<void> {
        const areaLabel = AREA_DEFINITIONS[area].label;
        const raw = await vscode.window.showInputBox({
            prompt: `Name for new ${areaLabel} item`,
            validateInput: value => {
                if (!value?.trim()) { return 'Name is required'; }
                const normalized = normalizeName(value);
                if (!normalized) { return 'Name must contain at least one alphanumeric character'; }
                return undefined;
            }
        });
        if (!raw) { return; }
        const name = normalizeName(raw);
        try {
            await createNewAreaItem(area, name, locationUri);
            await syncInstalledStatus();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to create "${name}": ${message}`);
        }
    }

    /**
     * Toolbar "New" handler: show a location quick pick, then prompt for name and create.
     */
    async function newItemFromToolbar(area: ContentArea): Promise<void> {
        const locations = pathService.getDefaultDownloadLocations(area);
        const defaultLoc = pathService.getDefaultDownloadLocation(area);

        const items: vscode.QuickPickItem[] = locations.map(loc => ({
            label: loc,
            description: normalizeSeparators(loc) === normalizeSeparators(defaultLoc) ? '(default)' : undefined
        }));

        // Add default if not already in the list
        if (!locations.some(l => normalizeSeparators(l) === normalizeSeparators(defaultLoc))) {
            items.unshift({ label: defaultLoc, description: '(default)' });
        }

        items.push({ label: 'Custom...', description: 'Enter a custom path' });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Where should the new ${AREA_DEFINITIONS[area].label} item be created?`
        });
        if (!selected) { return; }

        let locationPath: string;
        if (selected.label === 'Custom...') {
            const custom = await vscode.window.showInputBox({
                prompt: 'Enter a relative path or path starting with ~',
                validateInput: validateCustomLocation
            });
            if (!custom) { return; }
            locationPath = custom.trim();

            // If the path ends in .md, treat the last segment as the item name
            if (locationPath.endsWith('.md')) {
                const lastSlash = locationPath.lastIndexOf('/');
                const fileName = lastSlash >= 0 ? locationPath.substring(lastSlash + 1) : locationPath;
                const parentPath = lastSlash >= 0 ? locationPath.substring(0, lastSlash) : '.';
                const rawName = fileName.replace(/\.[^.]+$/, ''); // strip extension
                const name = normalizeName(rawName);
                if (!name) {
                    vscode.window.showErrorMessage('Name must contain at least one alphanumeric character.');
                    return;
                }
                const wf = pathService.getWorkspaceFolderForLocation(parentPath);
                const locationUri = pathService.resolveLocationToUri(parentPath, wf);
                if (!locationUri) {
                    vscode.window.showErrorMessage('Failed to resolve location.');
                    return;
                }
                try {
                    await createNewAreaItem(area, name, locationUri);
                    await syncInstalledStatus();
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Failed to create "${name}": ${message}`);
                }
                return;
            }
        } else {
            locationPath = selected.label;
        }

        const wf = pathService.getWorkspaceFolderForLocation(locationPath);
        if (pathService.requiresWorkspaceFolder(locationPath) && !wf) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
            return;
        }
        const locationUri = pathService.resolveLocationToUri(locationPath, wf);
        if (!locationUri) {
            vscode.window.showErrorMessage('Failed to resolve location.');
            return;
        }
        await promptAndCreateItem(area, locationUri);
    }

    for (const { area, viewId } of areaViewIds) {
        const provider = new InstalledAreaTreeDataProvider(context, pathService, area, viewId);
        areaProviders.set(viewId, provider);

        const treeView = vscode.window.createTreeView(viewId, {
            treeDataProvider: provider,
            showCollapseAll: true
        });
        provider.setTreeView(treeView);
        areaTreeViews.push(treeView);
        context.subscriptions.push(provider, treeView);
    }

    // ─── Section 4: Tree view registration ─────────────────────────────

    // Register TreeViews
    const marketplaceTreeView = vscode.window.createTreeView('agentOrganizer.marketplace', {
        treeDataProvider: marketplaceProvider,
        showCollapseAll: true
    });

    // Pass tree view reference to marketplace provider for reveal operations
    marketplaceProvider.setTreeView(marketplaceTreeView);

    const installedTreeView = vscode.window.createTreeView('agentOrganizer.skills', {
        treeDataProvider: installedProvider
    });

    // Pass tree view reference to provider for expand/collapse operations
    installedProvider.setTreeView(installedTreeView);

    // Handle expand/collapse events to persist state
    const collapseDisposable = installedTreeView.onDidCollapseElement(e => {
        installedProvider.onDidCollapseElement(e.element);
    });

    const expandDisposable = installedTreeView.onDidExpandElement(e => {
        installedProvider.onDidExpandElement(e.element);
    });
    
    context.subscriptions.push(collapseDisposable, expandDisposable);

    // ─── Section 5: Sync helper ─────────────────────────────────────────

    // Helper to sync installed status with marketplace
    const syncInstalledStatus = async () => {
        await installedProvider.refresh();
        await refreshAreaProviders();

        // Collect installed names from skills provider
        const allNames = new Set(installedProvider.getInstalledSkillNames());

        // Collect installed names from all area providers
        for (const provider of areaProviders.values()) {
            for (const item of provider.getInstalledItems()) {
                allNames.add(item.name);
            }
        }

        marketplaceProvider.setInstalledSkills(installedProvider.getInstalledSkillNames());
        marketplaceProvider.setInstalledItemNames(allNames);
    };

    // ─── Section 6: Command registration ────────────────────────────────

    // Register commands
    const commands = [
        // Search skills
        vscode.commands.registerCommand('agentOrganizer.search', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search skills',
                placeHolder: 'Enter skill name or keyword...'
            });
            if (query !== undefined) {
                marketplaceProvider.setSearchQuery(query);
            }
        }),

        // Clear search
        vscode.commands.registerCommand('agentOrganizer.clearSearch', () => {
            marketplaceProvider.clearSearch();
        }),

        // Search installed skills
        vscode.commands.registerCommand('agentOrganizer.searchInstalled', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search installed skills',
                placeHolder: 'Enter skill name or keyword...'
            });
            if (query !== undefined) {
                installedProvider.setSearchQuery(query);
            }
        }),

        // Clear installed search
        vscode.commands.registerCommand('agentOrganizer.clearSearchInstalled', () => {
            installedProvider.clearSearch();
        }),

        // Refresh marketplace only
        vscode.commands.registerCommand('agentOrganizer.refresh', async () => {
            await marketplaceProvider.refresh();
            marketplaceProvider.setInstalledSkills(installedProvider.getInstalledSkillNames());
        }),

        // Refresh installed skills only
        vscode.commands.registerCommand('agentOrganizer.refreshInstalled', async () => {
            await installedProvider.refresh();
            marketplaceProvider.setInstalledSkills(installedProvider.getInstalledSkillNames());
        }),

        // Area-specific refresh, search, clear search, and default download location commands
        ...areaViewIds.flatMap(({ area, viewId }) => {
            const provider = areaProviders.get(viewId)!;
            return [
                vscode.commands.registerCommand(`${viewId}.refresh`, () => provider.refresh()),
                vscode.commands.registerCommand(`${viewId}.search`, async () => {
                    const query = await vscode.window.showInputBox({ prompt: `Search ${AREA_DEFINITIONS[areaViewIds.find(a => a.viewId === viewId)!.area].label}` });
                    if (query !== undefined) { provider.setSearchQuery(query); }
                }),
                vscode.commands.registerCommand(`${viewId}.clearSearch`, () => provider.clearSearch()),
                vscode.commands.registerCommand(`${viewId}.expandAll`, () => provider.expandAll()),
                vscode.commands.registerCommand(`${viewId}.selectDefaultDownloadLocation`, () => selectDefaultDownloadLocation(area)),
                vscode.commands.registerCommand(`${viewId}.newItem`, () => newItemFromToolbar(area)),
            ];
        }),

        // Per-area sync and get-latest commands (delegate to the shared syncSkill/getLatestSkill handlers)
        ...(['Agent', 'Hook', 'Instruction', 'Plugin', 'Prompt'] as const).flatMap(suffix => [
            vscode.commands.registerCommand(`agentOrganizer.sync${suffix}`, (item: AreaInstalledItemTreeItem) => {
                vscode.commands.executeCommand('agentOrganizer.syncSkill', item);
            }),
            vscode.commands.registerCommand(`agentOrganizer.getLatest${suffix}`, (item: AreaInstalledItemTreeItem) => {
                vscode.commands.executeCommand('agentOrganizer.getLatestSkill', item);
            }),
        ]),

        // View skill details - opens in editor area as WebviewPanel
        vscode.commands.registerCommand('agentOrganizer.viewDetails', (item: SkillTreeItem | Skill | unknown) => {
            if (!item) {
                vscode.window.showErrorMessage('No skill selected.');
                return;
            }

            try {
                let skill: Skill | undefined;
                
                // Handle different input types
                if (item instanceof SkillTreeItem) {
                    skill = item.skill;
                } else {
                    // Try to cast to Skill
                    const skillData = item as Skill;
                    if (skillData.source) {
                        skill = skillData;
                    }
                }
                
                if (!skill || !skill.source) {
                    vscode.window.showErrorMessage('Invalid skill data. Please try again.');
                    return;
                }
                
                SkillDetailPanel.createOrShow(skill, context.extensionUri, installedProvider);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to open skill details: ${message}`);
            }
        }),

        // View details for a single-file area item (agents, instructions, prompts)
        vscode.commands.registerCommand('agentOrganizer.viewFileDetails', async (item: AreaFileItem | AreaFileTreeItem) => {
            // Accept both the raw AreaFileItem (from click command) and AreaFileTreeItem (from inline button)
            const fileItem = item instanceof AreaFileTreeItem ? item.fileItem : item;
            if (!fileItem?.source) {
                vscode.window.showErrorMessage('No item selected.');
                return;
            }
            try {
                // Fetch the file content from GitHub
                const content = await githubClient.fetchFileContent(
                    fileItem.source.owner, fileItem.source.repo,
                    fileItem.filePath, fileItem.source.branch
                );

                // Parse frontmatter if it's a markdown file
                const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
                let bodyContent = content;
                if (frontmatterMatch) {
                    bodyContent = frontmatterMatch[2];
                }

                // Create a Skill-like object for the detail panel
                const skill: Skill = {
                    name: fileItem.name,
                    description: fileItem.description || '',
                    source: fileItem.source,
                    skillPath: fileItem.filePath,
                    area: fileItem.area,
                    fullContent: content,
                    bodyContent
                };

                SkillDetailPanel.createOrShow(skill, context.extensionUri, installedProvider);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to load details: ${message}`);
            }
        }),

        // Install / download item
        vscode.commands.registerCommand('agentOrganizer.install', async (item: SkillTreeItem | Skill | AreaFileTreeItem | AreaFileItem) => {
            // Handle single-file area items (agents, instructions, prompts)
            if (item instanceof AreaFileTreeItem || (item && 'filePath' in item && 'area' in item && !('skillPath' in item))) {
                const fileItem: AreaFileItem = item instanceof AreaFileTreeItem ? item.fileItem : item as AreaFileItem;
                const area = fileItem.area;
                const downloadLocation = pathService.getDefaultDownloadLocation(area);
                const workspaceFolder = pathService.getWorkspaceFolderForLocation(downloadLocation);

                if (pathService.requiresWorkspaceFolder(downloadLocation) && !workspaceFolder) {
                    vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
                    return;
                }

                const targetDir = pathService.resolveLocationToUri(downloadLocation, workspaceFolder);
                if (!targetDir) {
                    vscode.window.showErrorMessage(`Failed to resolve download location for "${fileItem.name}".`);
                    return;
                }

                // Determine the file name from the filePath (last segment)
                const fileName = fileItem.filePath.split('/').pop() || fileItem.name;
                // If the item has a folderPath, preserve it
                const targetUri = fileItem.folderPath
                    ? vscode.Uri.joinPath(targetDir, fileItem.folderPath, fileName)
                    : vscode.Uri.joinPath(targetDir, fileName);

                try {
                    // Check if already exists
                    try {
                        await vscode.workspace.fs.stat(targetUri);
                        const overwrite = await vscode.window.showWarningMessage(
                            `"${fileName}" already exists. Overwrite?`,
                            { modal: true },
                            'Overwrite'
                        );
                        if (overwrite !== 'Overwrite') { return; }
                    } catch { /* doesn't exist, continue */ }

                    const content = await githubClient.fetchFileContent(
                        fileItem.source.owner, fileItem.source.repo,
                        fileItem.filePath, fileItem.source.branch
                    );

                    // Ensure parent directory exists
                    const parentUri = targetUri.with({ path: targetUri.path.replace(/\/[^/]+$/, '') });
                    await vscode.workspace.fs.createDirectory(parentUri);
                    await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(content));
                    vscode.window.showInformationMessage(`Successfully downloaded "${fileItem.name}"`);
                    await syncInstalledStatus();
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Failed to download: ${message}`);
                }
                return;
            }

            // Handle multi-file items (skills, plugins, hooks)
            const skill = item instanceof SkillTreeItem ? item.skill : item as Skill;
            if (skill) {
                const success = await installationService.installSkill(skill);
                if (success) {
                    await syncInstalledStatus();
                }
            }
        }),

        // Uninstall skill
        vscode.commands.registerCommand('agentOrganizer.uninstall', async (item: InstalledSkillTreeItem | InstalledSkill | Skill | AreaInstalledItemTreeItem) => {
            // Handle area installed items — delete the file/folder directly
            if (item instanceof AreaInstalledItemTreeItem) {
                try {
                    if (item.isSingleFile) {
                        await vscode.workspace.fs.delete(item.itemUri, { useTrash: true });
                    } else {
                        await vscode.workspace.fs.delete(item.itemUri, { recursive: true, useTrash: true });
                    }
                    vscode.window.showInformationMessage(`Successfully deleted "${item.installedItem.name}"`);
                    await syncInstalledStatus();
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Failed to delete: ${message}`);
                }
                return;
            }

            let installedSkill: InstalledSkill | undefined;
            
            // Handle different input types
            if (item instanceof InstalledSkillTreeItem) {
                installedSkill = item.installedSkill;
            } else if ('location' in item) {
                installedSkill = item as InstalledSkill;
            } else {
                const skill = item as Skill;
                installedSkill = installedProvider.getInstalledSkills().find(s => s.name === skill.name);
            }
            
            if (installedSkill) {
                const success = await installationService.uninstallSkill(installedSkill);
                if (success) {
                    await syncInstalledStatus();
                }
            }
        }),

        // Open skill folder
        vscode.commands.registerCommand('agentOrganizer.openSkillFolder', async (item: InstalledSkillTreeItem | AreaInstalledItemTreeItem) => {
            if (item instanceof AreaInstalledItemTreeItem) {
                const def = AREA_DEFINITIONS[item.area];
                try {
                    if (item.isSingleFile) {
                        // Single-file areas: open the file directly
                        await vscode.window.showTextDocument(item.itemUri);
                    } else if (def.definitionFile) {
                        // Multi-file areas: find and open the definition file
                        // For plugins, the definition file may be nested (e.g. .github/plugin/plugin.json)
                        const defFileUri = await findDefinitionFile(item.itemUri, def.definitionFile);
                        if (defFileUri) {
                            await vscode.commands.executeCommand('revealInExplorer', item.itemUri);
                            await vscode.window.showTextDocument(defFileUri);
                        } else {
                            await vscode.commands.executeCommand('revealInExplorer', item.itemUri);
                        }
                    } else {
                        await vscode.commands.executeCommand('revealInExplorer', item.itemUri);
                    }
                } catch {
                    // ignore
                }
            } else if (item?.installedSkill) {
                await installationService.openSkillFolder(item.installedSkill);
            }
        }),

        // Reveal item in system file explorer
        vscode.commands.registerCommand('agentOrganizer.revealInFileExplorer', (item: LocationTreeItem | InstalledSkillTreeItem | SkillFolderTreeItem | SkillFileTreeItem | AreaLocationTreeItem | AreaInstalledItemTreeItem | AreaItemFolderTreeItem | AreaItemFileTreeItem) => {
            let uri: vscode.Uri | undefined;
            if (item instanceof SkillFileTreeItem) {
                uri = item.fileUri;
            } else if (item instanceof SkillFolderTreeItem) {
                uri = item.folderUri;
            } else if (item instanceof InstalledSkillTreeItem) {
                uri = item.skillUri;
            } else if (item instanceof LocationTreeItem) {
                const workspaceFolder = pathService.getWorkspaceFolderForLocation(item.location);
                uri = pathService.resolveLocationToUri(item.location, workspaceFolder);
            } else if (item instanceof AreaItemFileTreeItem) {
                uri = item.fileUri;
            } else if (item instanceof AreaItemFolderTreeItem) {
                uri = item.folderUri;
            } else if (item instanceof AreaInstalledItemTreeItem) {
                uri = item.itemUri;
            } else if (item instanceof AreaLocationTreeItem) {
                const workspaceFolder = pathService.getWorkspaceFolderForLocation(item.location);
                uri = pathService.resolveLocationToUri(item.location, workspaceFolder);
            }
            if (uri) {
                vscode.commands.executeCommand('revealFileInOS', uri);
            }
        }),

        // Add a new file inside a skill or skill subfolder
        vscode.commands.registerCommand('agentOrganizer.addFile', async (item: InstalledSkillTreeItem | SkillFolderTreeItem | AreaInstalledItemTreeItem | AreaItemFolderTreeItem) => {
            const fileName = await vscode.window.showInputBox({
                prompt: 'File name',
                validateInput: value => validateItemName(value, 'File name')
            });
            if (!fileName) { return; }
            const fileUri = vscode.Uri.joinPath(resolveParentUri(item), fileName.trim());
            await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
            await vscode.commands.executeCommand('vscode.open', fileUri);
            if (item instanceof InstalledSkillTreeItem || item instanceof SkillFolderTreeItem) {
                await installedProvider.refresh();
            } else {
                refreshAreaProviders();
            }
        }),

        // Add a new folder inside a skill or skill subfolder
        vscode.commands.registerCommand('agentOrganizer.addFolder', async (item: InstalledSkillTreeItem | SkillFolderTreeItem | AreaInstalledItemTreeItem | AreaItemFolderTreeItem) => {
            const folderName = await vscode.window.showInputBox({
                prompt: 'Folder name',
                validateInput: value => validateItemName(value, 'Folder name')
            });
            if (!folderName) { return; }
            const folderUri = vscode.Uri.joinPath(resolveParentUri(item), folderName.trim());
            await vscode.workspace.fs.createDirectory(folderUri);
            if (item instanceof InstalledSkillTreeItem || item instanceof SkillFolderTreeItem) {
                await installedProvider.refresh();
            } else {
                refreshAreaProviders();
            }
        }),

        // Rename a file inside a skill or area folder
        vscode.commands.registerCommand('agentOrganizer.renameFile', async (item: SkillFileTreeItem | AreaItemFileTreeItem) => {
            const oldName = item instanceof SkillFileTreeItem ? item.fileName : item.fileName;
            const fileUri = item instanceof SkillFileTreeItem ? item.fileUri : item.fileUri;
            const parentUri = fileUri.with({ path: fileUri.path.replace(/\/[^/]+$/, '') });
            const newName = await vscode.window.showInputBox({
                prompt: 'New file name',
                value: oldName,
                validateInput: value => validateItemName(value, 'File name')
            });
            if (!newName || newName.trim() === oldName) { return; }
            const newUri = vscode.Uri.joinPath(parentUri, newName.trim());
            await vscode.workspace.fs.rename(fileUri, newUri);
            if (item instanceof SkillFileTreeItem) {
                await installedProvider.refresh();
            } else {
                refreshAreaProviders();
            }
        }),

        // Delete a file inside a skill or area folder (moved to trash)
        vscode.commands.registerCommand('agentOrganizer.deleteSkillFile', async (item: SkillFileTreeItem | AreaItemFileTreeItem) => {
            const fileUri = item instanceof SkillFileTreeItem ? item.fileUri : item.fileUri;
            await vscode.workspace.fs.delete(fileUri, { useTrash: true });
            if (item instanceof SkillFileTreeItem) {
                await installedProvider.refresh();
            } else {
                refreshAreaProviders();
            }
        }),

        // Delete a subfolder inside a skill or area folder (moved to trash)
        vscode.commands.registerCommand('agentOrganizer.deleteSkillFolder', async (item: SkillFolderTreeItem | AreaItemFolderTreeItem) => {
            const folderUri = item instanceof SkillFolderTreeItem ? item.folderUri : item.folderUri;
            await vscode.workspace.fs.delete(folderUri, { recursive: true, useTrash: true });
            if (item instanceof SkillFolderTreeItem) {
                await installedProvider.refresh();
            } else {
                refreshAreaProviders();
            }
        }),

        // Copy the item name to the clipboard
        vscode.commands.registerCommand('agentOrganizer.copyItemName', async (item: InstalledSkillTreeItem | AreaInstalledItemTreeItem) => {
            const name = item instanceof InstalledSkillTreeItem
                ? item.installedSkill.name
                : item.installedItem.name;
            await vscode.env.clipboard.writeText(name);
            vscode.window.showInformationMessage(`Copied "${name}" to clipboard.`);
        }),

        // Rename an installed area item or skill
        vscode.commands.registerCommand('agentOrganizer.renameItem', async (item: InstalledSkillTreeItem | AreaInstalledItemTreeItem) => {
            if (!item) { return; }
            const isSkill = item instanceof InstalledSkillTreeItem;
            const oldName = isSkill ? item.installedSkill.name : item.installedItem.name;
            const itemUri = isSkill ? item.skillUri : item.itemUri;
            const isSingleFile = !isSkill && item.isSingleFile;
            const area: ContentArea | undefined = isSkill ? 'skills' : (item as AreaInstalledItemTreeItem).area;

            const newName = await vscode.window.showInputBox({
                prompt: `Rename "${oldName}"`,
                value: oldName,
                validateInput: value => {
                    if (!value?.trim()) { return 'Name is required'; }
                    if (/[/\\]/.test(value)) { return 'Name cannot contain path separators'; }
                    if (value.trim() === '.' || value.trim() === '..') { return "Name cannot be '.' or '..'"; }
                    if (/\.\./.test(value.trim())) { return "Name cannot contain '..'"; }
                    return undefined;
                }
            });
            if (!newName || newName.trim() === oldName) { return; }
            const trimmed = newName.trim();
            const normalized = normalizeName(trimmed);

            try {
                if (isSingleFile) {
                    // Single-file item: rename the file, preserving its extension
                    const oldBaseName = itemUri.path.split('/').pop() || '';
                    const dotIdx = oldBaseName.indexOf('.');
                    const extension = dotIdx >= 0 ? oldBaseName.substring(dotIdx) : '';
                    const newFileName = normalized + extension;
                    const parentUri = vscode.Uri.joinPath(itemUri, '..');
                    const newUri = vscode.Uri.joinPath(parentUri, newFileName);
                    await vscode.workspace.fs.rename(itemUri, newUri);
                    // Update frontmatter name in the renamed file
                    await updateFrontmatterName(newUri, normalized);
                } else {
                    // Multi-file item (folder-based): rename the folder
                    const parentUri = vscode.Uri.joinPath(itemUri, '..');
                    const newUri = vscode.Uri.joinPath(parentUri, normalized);
                    await vscode.workspace.fs.rename(itemUri, newUri);
                    // Update the name in the definition file
                    const def = area ? AREA_DEFINITIONS[area] : undefined;
                    if (def) {
                        const defFileName = def.definitionFile;
                        if (defFileName) {
                            const defUri = await findDefinitionFile(newUri, defFileName);
                            if (defUri) {
                                if (defFileName.endsWith('.json')) {
                                    await updateJsonDefinitionName(defUri, normalized);
                                } else {
                                    await updateFrontmatterName(defUri, normalized);
                                }
                            }
                        }
                    }
                }

                if (isSkill) {
                    await installedProvider.refresh();
                } else {
                    refreshAreaProviders();
                }
                await syncInstalledStatus();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to rename "${oldName}": ${message}`);
            }
        }),

        // Move skill to a different location
        vscode.commands.registerCommand('agentOrganizer.moveSkill', async (item: InstalledSkillTreeItem | AreaInstalledItemTreeItem | LocationTreeItem | AreaLocationTreeItem) => {
            if (item instanceof AreaLocationTreeItem) {
                await moveOrCopyAreaLocation(item, 'move');
            } else if (item instanceof LocationTreeItem) {
                await moveOrCopySkillLocation(item, 'move');
            } else if (item instanceof AreaInstalledItemTreeItem) {
                await moveOrCopyAreaItem(item, 'move');
            } else if (item?.installedSkill) {
                const success = await installationService.moveSkill(item.installedSkill);
                if (success) {
                    await syncInstalledStatus();
                }
            }
        }),

        // Copy skill to a different location
        vscode.commands.registerCommand('agentOrganizer.copySkill', async (item: InstalledSkillTreeItem | AreaInstalledItemTreeItem | LocationTreeItem | AreaLocationTreeItem) => {
            if (item instanceof AreaLocationTreeItem) {
                await moveOrCopyAreaLocation(item, 'copy');
            } else if (item instanceof LocationTreeItem) {
                await moveOrCopySkillLocation(item, 'copy');
            } else if (item instanceof AreaInstalledItemTreeItem) {
                await moveOrCopyAreaItem(item, 'copy');
            } else if (item?.installedSkill) {
                const success = await installationService.copySkill(item.installedSkill);
                if (success) {
                    await syncInstalledStatus();
                }
            }
        }),

        // Copy an item into a plugin's subfolder
        vscode.commands.registerCommand('agentOrganizer.copyToPlugin', async (item: InstalledSkillTreeItem | AreaInstalledItemTreeItem) => {
            // Determine the source area and the target plugin subfolder
            let sourceArea: ContentArea;
            let sourceUri: vscode.Uri;
            let itemName: string;

            if (item instanceof AreaInstalledItemTreeItem) {
                sourceArea = item.area;
                sourceUri = item.itemUri;
                itemName = item.installedItem.name;
            } else if (item instanceof InstalledSkillTreeItem) {
                sourceArea = 'skills';
                sourceUri = item.skillUri;
                itemName = item.installedSkill.name;
            } else {
                return;
            }

            const targetSubfolder = AREA_TO_PLUGIN_SUBFOLDER[sourceArea];
            if (!targetSubfolder) {
                vscode.window.showWarningMessage(`"Copy to Plugin" is not supported for ${AREA_DEFINITIONS[sourceArea].label} items.`);
                return;
            }

            // Get all installed plugins from the plugins area provider
            const pluginsProvider = areaProviders.get('agentOrganizer.plugins');
            if (!pluginsProvider) { return; }
            const plugins = pluginsProvider.getInstalledItems();

            if (plugins.length === 0) {
                vscode.window.showInformationMessage('No plugins installed. Download a plugin from the Marketplace first.');
                return;
            }

            // Show quick pick of available plugins
            const picks = plugins.map(p => ({
                label: p.name,
                description: p.location,
                plugin: p
            }));

            const selected = await vscode.window.showQuickPick(picks, {
                placeHolder: `Copy "${itemName}" to which plugin?`
            });
            if (!selected) { return; }

            // Resolve the plugin's directory
            const pluginLoc = normalizeSeparators(selected.plugin.location);
            const pluginWorkspaceFolder = pathService.getWorkspaceFolderForLocation(pluginLoc);
            const pluginUri = pathService.resolveLocationToUri(pluginLoc, pluginWorkspaceFolder);
            if (!pluginUri) {
                vscode.window.showErrorMessage('Failed to resolve plugin location.');
                return;
            }

            // Create the target subfolder inside the plugin if it doesn't exist
            const targetDir = vscode.Uri.joinPath(pluginUri, targetSubfolder);
            await vscode.workspace.fs.createDirectory(targetDir);

            // Determine the target name (file name for single-file, folder name for multi-file)
            const sourceLoc = normalizeSeparators(item instanceof AreaInstalledItemTreeItem ? item.installedItem.location : item.installedSkill.location);
            const sourceBaseName = sourceLoc.substring(sourceLoc.lastIndexOf('/') + 1);
            const targetUri = vscode.Uri.joinPath(targetDir, sourceBaseName);

            // Check if target already exists
            try {
                await vscode.workspace.fs.stat(targetUri);
                const overwrite = await vscode.window.showWarningMessage(
                    `"${sourceBaseName}" already exists in ${selected.label}/${targetSubfolder}. Overwrite?`,
                    { modal: true },
                    'Overwrite'
                );
                if (overwrite !== 'Overwrite') { return; }
                await vscode.workspace.fs.delete(targetUri, { recursive: true, useTrash: true });
            } catch { /* doesn't exist, continue */ }

            try {
                await vscode.workspace.fs.copy(sourceUri, targetUri, { overwrite: true });
                vscode.window.showInformationMessage(`Copied "${itemName}" to ${selected.label}/${targetSubfolder}`);
                await syncInstalledStatus();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to copy to plugin: ${message}`);
            }
        }),

        // Update all plugins that contain a copy of this item
        vscode.commands.registerCommand('agentOrganizer.updatePlugins', async (item: InstalledSkillTreeItem | AreaInstalledItemTreeItem) => {
            let sourceArea: ContentArea;
            let sourceUri: vscode.Uri;
            let itemName: string;
            let sourceBaseName: string;

            if (item instanceof AreaInstalledItemTreeItem) {
                sourceArea = item.area;
                sourceUri = item.itemUri;
                itemName = item.installedItem.name;
                const sourceLoc = normalizeSeparators(item.installedItem.location);
                sourceBaseName = sourceLoc.substring(sourceLoc.lastIndexOf('/') + 1);
            } else if (item instanceof InstalledSkillTreeItem) {
                sourceArea = 'skills';
                sourceUri = item.skillUri;
                itemName = item.installedSkill.name;
                const sourceLoc = normalizeSeparators(item.installedSkill.location);
                sourceBaseName = sourceLoc.substring(sourceLoc.lastIndexOf('/') + 1);
            } else {
                return;
            }

            const targetSubfolder = AREA_TO_PLUGIN_SUBFOLDER[sourceArea];
            if (!targetSubfolder) {
                vscode.window.showWarningMessage(`"Update Plugins" is not supported for ${AREA_DEFINITIONS[sourceArea].label} items.`);
                return;
            }

            // Get all installed plugins
            const pluginsProvider = areaProviders.get('agentOrganizer.plugins');
            if (!pluginsProvider) { return; }
            const plugins = pluginsProvider.getInstalledItems();

            if (plugins.length === 0) {
                vscode.window.showInformationMessage('No plugins installed.');
                return;
            }

            let updatedCount = 0;
            const results: { pluginName: string; updated: boolean; reason?: string }[] = [];

            for (const plugin of plugins) {
                const pluginLoc = normalizeSeparators(plugin.location);
                const pluginWf = pathService.getWorkspaceFolderForLocation(pluginLoc);
                const pluginUri = pathService.resolveLocationToUri(pluginLoc, pluginWf);
                if (!pluginUri) { continue; }

                const targetUri = vscode.Uri.joinPath(pluginUri, targetSubfolder, sourceBaseName);
                try {
                    await vscode.workspace.fs.stat(targetUri);
                } catch {
                    // Item doesn't exist in this plugin — skip
                    continue;
                }

                try {
                    await vscode.workspace.fs.delete(targetUri, { recursive: true, useTrash: true });
                    await vscode.workspace.fs.copy(sourceUri, targetUri, { overwrite: true });
                    updatedCount++;
                    results.push({ pluginName: plugin.name, updated: true });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    results.push({ pluginName: plugin.name, updated: false, reason: message });
                }
            }

            if (results.length === 0) {
                vscode.window.showInformationMessage(`"${itemName}" was not found in any plugin.`);
            } else {
                await showSyncResults(
                    `Update Plugins — "${itemName}"`,
                    `Updated "${itemName}" in ${updatedCount} plugin(s).`,
                    results.map(r => ({ label: r.pluginName, updated: r.updated, reason: r.reason }))
                );
            }
            await syncInstalledStatus();
        }),

        // Get latest copy of all AI tools in a plugin (agents, skills, commands, hooks)
        vscode.commands.registerCommand('agentOrganizer.pluginGetLatestAll', async (item: AreaInstalledItemTreeItem) => {
            if (!item || item.area !== 'plugins') { return; }
            const pluginUri = item.itemUri;
            const allResults: { area: string; name: string; updated: boolean; reason?: string }[] = [];

            for (const subfolder of PLUGIN_AREA_SUBFOLDERS) {
                const area = PLUGIN_SUBFOLDER_TO_AREA[subfolder];
                const subfolderUri = vscode.Uri.joinPath(pluginUri, subfolder);
                try { await vscode.workspace.fs.stat(subfolderUri); } catch { continue; }

                let sourceItems: InstalledSkill[];
                if (area === 'skills') {
                    sourceItems = installedProvider.getInstalledSkills();
                } else {
                    const viewId = areaViewIds.find(a => a.area === area)?.viewId;
                    const provider = viewId ? areaProviders.get(viewId) : undefined;
                    sourceItems = provider ? provider.getInstalledItems() : [];
                }

                try {
                    const entries = await vscode.workspace.fs.readDirectory(subfolderUri);
                    for (const [name] of entries) {
                        const itemUri = vscode.Uri.joinPath(subfolderUri, name);
                        const def = AREA_DEFINITIONS[area];
                        const itemName = def.kind === 'singleFile' && def.fileSuffix && name.endsWith(def.fileSuffix)
                            ? name.substring(0, name.length - def.fileSuffix.length)
                            : name;
                        const resolveUri = (i: InstalledSkill) => resolveInstalledItemUri(i, pathService);
                        const result = await syncPluginItem(itemUri, itemName, sourceItems, resolveUri);
                        allResults.push({ area: AREA_DEFINITIONS[area].label, name: itemName, ...result });
                    }
                } catch { /* can't read subfolder */ }
            }

            if (allResults.length === 0) {
                vscode.window.showInformationMessage(`No AI tool subfolders found in "${item.installedItem.name}".`);
            } else {
                const updated = allResults.filter(r => r.updated).length;
                await showSyncResults(
                    `Get Latest — "${item.installedItem.name}"`,
                    `Updated ${updated} of ${allResults.length} item(s) in "${item.installedItem.name}".`,
                    allResults.map(r => ({ label: `[${r.area}] ${r.name}`, updated: r.updated, reason: r.reason }))
                );
            }
            await syncInstalledStatus();
        }),

        // Get latest copies of all items in a plugin area subfolder
        vscode.commands.registerCommand('agentOrganizer.pluginGetLatestFolder', async (item: AreaItemFolderTreeItem) => {
            if (!item) { return; }
            const folderName = item.folderName;
            const area = PLUGIN_SUBFOLDER_TO_AREA[folderName];

            if (!area) {
                // Not an area subfolder — this is an individual item (e.g. a skill folder).
                // Delegate to the single-item sync by invoking the same logic as pluginGetLatestItem.
                await vscode.commands.executeCommand('agentOrganizer.pluginGetLatestItem', item);
                return;
            }

            // Get source items
            let sourceItems: InstalledSkill[];
            if (area === 'skills') {
                sourceItems = installedProvider.getInstalledSkills();
            } else {
                const viewId = areaViewIds.find(a => a.area === area)?.viewId;
                const provider = viewId ? areaProviders.get(viewId) : undefined;
                sourceItems = provider ? provider.getInstalledItems() : [];
            }

            const results: { name: string; updated: boolean; reason?: string }[] = [];
            try {
                const entries = await vscode.workspace.fs.readDirectory(item.folderUri);
                for (const [name] of entries) {
                    const itemUri = vscode.Uri.joinPath(item.folderUri, name);
                    const def = AREA_DEFINITIONS[area];
                    const itemName = def.kind === 'singleFile' && def.fileSuffix && name.endsWith(def.fileSuffix)
                        ? name.substring(0, name.length - def.fileSuffix.length)
                        : name;

                    const resolveUri = (i: InstalledSkill) => resolveInstalledItemUri(i, pathService);
                    const result = await syncPluginItem(itemUri, itemName, sourceItems, resolveUri);
                    results.push({ name: itemName, ...result });
                }
            } catch { /* can't read folder */ }

            const areaLabel = AREA_DEFINITIONS[area].label;
            const updated = results.filter(r => r.updated).length;
            await showSyncResults(
                `Get Latest — ${areaLabel}`,
                `${areaLabel}: Updated ${updated} of ${results.length} item(s).`,
                results.map(r => ({ label: r.name, updated: r.updated, reason: r.reason }))
            );
            await syncInstalledStatus();
        }),

        // Get latest copy of a single item in a plugin area subfolder
        vscode.commands.registerCommand('agentOrganizer.pluginGetLatestItem', async (item: AreaItemFileTreeItem | AreaItemFolderTreeItem) => {
            if (!item) { return; }

            // Determine the item's URI and name
            const itemUri = item instanceof AreaItemFileTreeItem ? item.fileUri : item.folderUri;
            const itemFileName = item instanceof AreaItemFileTreeItem ? item.fileName : item.folderName;

            // Walk up to find the area subfolder name
            let parent: AreaInstalledItemTreeItem | AreaItemFolderTreeItem | undefined;
            if (item instanceof AreaItemFileTreeItem) {
                parent = item.parentFolder;
            } else {
                parent = item.parentItem;
            }

            let subfolderName: string | undefined;
            while (parent) {
                if (parent instanceof AreaItemFolderTreeItem) {
                    if (PLUGIN_SUBFOLDER_TO_AREA[parent.folderName]) {
                        subfolderName = parent.folderName;
                        break;
                    }
                    parent = parent.parentItem;
                } else if (parent instanceof AreaInstalledItemTreeItem) {
                    // We've reached the plugin root without finding an area subfolder.
                    // Check if the item itself is directly under the plugin — meaning
                    // the item's parent is the plugin and the item name might be an area folder.
                    break;
                } else {
                    break;
                }
            }

            // If the item is a folder directly under the plugin and its name is an area subfolder,
            // that's the pluginGetLatestFolder case, not this one. But if the item is inside
            // an area subfolder, we proceed.
            if (!subfolderName) {
                vscode.window.showInformationMessage(`Could not determine the AI tool area for "${itemFileName}".`);
                return;
            }

            const area = PLUGIN_SUBFOLDER_TO_AREA[subfolderName];
            let sourceItems: InstalledSkill[];
            if (area === 'skills') {
                sourceItems = installedProvider.getInstalledSkills();
            } else {
                const viewId = areaViewIds.find(a => a.area === area)?.viewId;
                const provider = viewId ? areaProviders.get(viewId) : undefined;
                sourceItems = provider ? provider.getInstalledItems() : [];
            }

            const def = AREA_DEFINITIONS[area];
            const itemName = def.kind === 'singleFile' && def.fileSuffix && itemFileName.endsWith(def.fileSuffix)
                ? itemFileName.substring(0, itemFileName.length - def.fileSuffix.length)
                : itemFileName;

            const resolveUri = (i: InstalledSkill) => resolveInstalledItemUri(i, pathService);
            const result = await syncPluginItem(itemUri, itemName, sourceItems, resolveUri);

            if (result.updated) {
                vscode.window.showInformationMessage(`Updated "${itemFileName}" with latest copy.`);
            } else {
                vscode.window.showInformationMessage(`Could not update "${itemFileName}": ${result.reason || 'unknown reason'}.`);
            }
            await syncInstalledStatus();
        }),

        // Copy an item from a plugin's area subfolder to the corresponding installed area location
        vscode.commands.registerCommand('agentOrganizer.pluginCopyToArea', async (item: AreaItemFileTreeItem | AreaItemFolderTreeItem) => {
            if (!item) { return; }

            const itemUri = item instanceof AreaItemFileTreeItem ? item.fileUri : item.folderUri;
            const itemFileName = item instanceof AreaItemFileTreeItem ? item.fileName : item.folderName;

            // Walk up to find the area subfolder name
            let parent: AreaInstalledItemTreeItem | AreaItemFolderTreeItem | undefined;
            if (item instanceof AreaItemFileTreeItem) {
                parent = item.parentFolder;
            } else {
                parent = item.parentItem;
            }

            let subfolderName: string | undefined;
            while (parent) {
                if (parent instanceof AreaItemFolderTreeItem) {
                    if (PLUGIN_SUBFOLDER_TO_AREA[parent.folderName]) {
                        subfolderName = parent.folderName;
                        break;
                    }
                    parent = parent.parentItem;
                } else {
                    break;
                }
            }

            if (!subfolderName) {
                vscode.window.showInformationMessage(`Could not determine the AI tool area for "${itemFileName}".`);
                return;
            }

            const area = PLUGIN_SUBFOLDER_TO_AREA[subfolderName];
            const areaLabel = AREA_DEFINITIONS[area].label;
            const downloadLocation = pathService.getDefaultDownloadLocation(area);
            const workspaceFolder = pathService.getWorkspaceFolderForLocation(downloadLocation);

            if (pathService.requiresWorkspaceFolder(downloadLocation) && !workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
                return;
            }

            const targetDir = pathService.resolveLocationToUri(downloadLocation, workspaceFolder);
            if (!targetDir) {
                vscode.window.showErrorMessage(`Failed to resolve ${areaLabel} location.`);
                return;
            }

            await vscode.workspace.fs.createDirectory(targetDir);
            const targetUri = vscode.Uri.joinPath(targetDir, itemFileName);

            // Check if target already exists
            try {
                await vscode.workspace.fs.stat(targetUri);
                const overwrite = await vscode.window.showWarningMessage(
                    `"${itemFileName}" already exists in ${downloadLocation}. Overwrite?`,
                    { modal: true },
                    'Overwrite'
                );
                if (overwrite !== 'Overwrite') { return; }
                await vscode.workspace.fs.delete(targetUri, { recursive: true, useTrash: true });
            } catch { /* doesn't exist */ }

            try {
                await vscode.workspace.fs.copy(itemUri, targetUri, { overwrite: true });
                vscode.window.showInformationMessage(`Copied "${itemFileName}" to ${areaLabel} (${downloadLocation})`);
                await syncInstalledStatus();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to copy: ${message}`);
            }
        }),

        // Update older copies of an item from the newest version
        vscode.commands.registerCommand('agentOrganizer.syncSkill', async (item: InstalledSkillTreeItem | AreaInstalledItemTreeItem) => {
            if (item instanceof AreaInstalledItemTreeItem) {
                // Area item sync: copy this (newest) item to all other locations with the same name
                const viewId = areaViewIds.find(a => a.area === item.area)?.viewId;
                const provider = viewId ? areaProviders.get(viewId) : undefined;
                if (!provider) { return; }
                const allItems = provider.getInstalledItems();
                const duplicates = allItems.filter(
                    i => i.name === item.installedItem.name && i.location !== item.installedItem.location
                );
                if (duplicates.length === 0) {
                    vscode.window.showInformationMessage(`No other copies of "${item.installedItem.name}" to synchronize.`);
                    return;
                }
                let synced = 0;
                for (const target of duplicates) {
                    const targetLoc = normalizeSeparators(target.location);
                    const targetWf = pathService.getWorkspaceFolderForLocation(targetLoc);
                    const targetUri = pathService.resolveLocationToUri(targetLoc, targetWf);
                    if (!targetUri) { continue; }
                    try {
                        await vscode.workspace.fs.delete(targetUri, { recursive: true, useTrash: true });
                        await vscode.workspace.fs.copy(item.itemUri, targetUri, { overwrite: true });
                        synced++;
                    } catch { /* skip */ }
                }
                if (synced > 0) {
                    vscode.window.showInformationMessage(
                        `Synchronized "${item.installedItem.name}" to ${synced} location${synced !== 1 ? 's' : ''}.`
                    );
                }
                await syncInstalledStatus();
            } else if (item?.installedSkill) {
                const success = await installationService.syncSkill(
                    item.installedSkill,
                    installedProvider.getInstalledSkills()
                );
                if (success) {
                    await syncInstalledStatus();
                }
            }
        }),

        // Get latest version of an item from the newest copy
        vscode.commands.registerCommand('agentOrganizer.getLatestSkill', async (item: InstalledSkillTreeItem | AreaInstalledItemTreeItem) => {
            if (item instanceof AreaInstalledItemTreeItem) {
                // Area item get-latest: replace this (older) copy with the newest
                const viewId = areaViewIds.find(a => a.area === item.area)?.viewId;
                const provider = viewId ? areaProviders.get(viewId) : undefined;
                if (!provider) { return; }
                const newest = provider.findNewestCopy(item.installedItem.name);
                if (!newest) { return; }
                const newestLoc = normalizeSeparators(newest.location);
                const newestWf = pathService.getWorkspaceFolderForLocation(newestLoc);
                const newestUri = pathService.resolveLocationToUri(newestLoc, newestWf);
                if (!newestUri) { return; }
                try {
                    await vscode.workspace.fs.delete(item.itemUri, { recursive: true, useTrash: true });
                    await vscode.workspace.fs.copy(newestUri, item.itemUri, { overwrite: true });
                    vscode.window.showInformationMessage(`Updated "${item.installedItem.name}" from latest copy.`);
                    await syncInstalledStatus();
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Failed to get latest: ${message}`);
                }
            } else if (item?.installedSkill) {
                const newest = installedProvider.findNewestCopy(item.installedSkill.name);
                if (newest) {
                    const success = await installationService.getLatestSkillFrom(item.installedSkill, newest);
                    if (success) {
                        await syncInstalledStatus();
                    }
                }
            }
        }),

        // Delete all skills in a location folder
        vscode.commands.registerCommand('agentOrganizer.deleteAllSkills', async (item: LocationTreeItem | AreaLocationTreeItem) => {
            if (item instanceof AreaLocationTreeItem) {
                // Delete all items in this area location
                for (const areaItem of item.items) {
                    const normalizedLoc = normalizeSeparators(areaItem.location);
                    const lastSlash = normalizedLoc.lastIndexOf('/');
                    const parentLoc = lastSlash > 0 ? normalizedLoc.substring(0, lastSlash) : normalizedLoc;
                    const itemName = normalizedLoc.substring(lastSlash + 1);
                    const workspaceFolder = pathService.getWorkspaceFolderForLocation(parentLoc);
                    const parentUri = pathService.resolveLocationToUri(parentLoc, workspaceFolder);
                    if (parentUri) {
                        const itemUri = vscode.Uri.joinPath(parentUri, itemName);
                        try {
                            await vscode.workspace.fs.delete(itemUri, { recursive: true, useTrash: true });
                        } catch { /* ignore */ }
                    }
                }
                await syncInstalledStatus();
            } else if (item?.skills) {
                const success = await installationService.deleteAllSkillsInLocation(item.location, item.skills);
                if (success) {
                    await syncInstalledStatus();
                }
            }
        }),

        // Show an installed skill in the Marketplace view
        vscode.commands.registerCommand('agentOrganizer.showInMarketplace', async (item: InstalledSkillTreeItem | AreaInstalledItemTreeItem) => {
            if (item instanceof AreaInstalledItemTreeItem) {
                await marketplaceProvider.revealItemByName(item.installedItem.name);
            } else if (item?.installedSkill) {
                await marketplaceProvider.revealItemByName(item.installedSkill.name);
            }
        }),

        // Focus marketplace view (used in welcome message)
        vscode.commands.registerCommand('agentOrganizer.focusMarketplace', () => {
            marketplaceTreeView.reveal(undefined as unknown as SkillTreeItem, { focus: true });
        }),

        // Select install location (skills — legacy command, delegates to generic handler)
        vscode.commands.registerCommand('agentOrganizer.selectInstallLocation', async () => {
            await selectDefaultDownloadLocation('skills');
        }),

        // Expand all installed skills locations
        vscode.commands.registerCommand('agentOrganizer.expandAll', async () => {
            await installedProvider.expandAll();
        }),

        // Collapse all installed skills locations
        vscode.commands.registerCommand('agentOrganizer.collapseAll', async () => {
            await installedProvider.collapseAll();
            // Use the built-in command to actually collapse the tree widget,
            // since TreeDataProvider has no API to programmatically collapse nodes.
            await vscode.commands.executeCommand('workbench.actions.treeView.agentOrganizer.skills.collapseAll');
        }),

        // New item from Skills toolbar
        vscode.commands.registerCommand('agentOrganizer.newSkillItem', () => newItemFromToolbar('skills')),

        // New item from right-click on a location folder (area views)
        vscode.commands.registerCommand('agentOrganizer.newItemAtLocation', async (item: AreaLocationTreeItem) => {
            if (!item) { return; }
            // Determine which area this location belongs to
            let targetArea: ContentArea | undefined;
            for (const { area, viewId } of areaViewIds) {
                const provider = areaProviders.get(viewId);
                if (provider && provider.getInstalledItems().some(i => {
                    const parentLoc = normalizeSeparators(i.location);
                    const lastSlash = parentLoc.lastIndexOf('/');
                    const parent = lastSlash > 0 ? parentLoc.substring(0, lastSlash) : parentLoc;
                    return parent === item.location;
                })) {
                    targetArea = area;
                    break;
                }
            }
            // If no items exist yet, try matching by location path
            if (!targetArea) {
                for (const { area, viewId } of areaViewIds) {
                    const provider = areaProviders.get(viewId);
                    if (provider) {
                        // Check if this location is one of the area's scan locations
                        const locations = pathService.getDefaultDownloadLocations(area).map(normalizeSeparators);
                        const defaultLoc = normalizeSeparators(pathService.getDefaultDownloadLocation(area));
                        if (locations.includes(item.location) || defaultLoc === item.location) {
                            targetArea = area;
                            break;
                        }
                    }
                }
            }
            if (!targetArea) { return; }

            const wf = pathService.getWorkspaceFolderForLocation(item.location);
            const locationUri = pathService.resolveLocationToUri(item.location, wf);
            if (!locationUri) {
                vscode.window.showErrorMessage('Failed to resolve location.');
                return;
            }
            await promptAndCreateItem(targetArea, locationUri);
        }),

        // New item from right-click on a Skills location folder
        vscode.commands.registerCommand('agentOrganizer.newSkillAtLocation', async (item: LocationTreeItem) => {
            if (!item) { return; }
            const wf = pathService.getWorkspaceFolderForLocation(item.location);
            const locationUri = pathService.resolveLocationToUri(item.location, wf);
            if (!locationUri) {
                vscode.window.showErrorMessage('Failed to resolve location.');
                return;
            }
            await promptAndCreateItem('skills', locationUri);
        }),

        // Per-area "Add {Area}" right-click commands on location folders
        ...([
            ['agentOrganizer.newAgentAtLocation', 'agents'],
            ['agentOrganizer.newHookGithubAtLocation', 'hooksGithub'],
            ['agentOrganizer.newHookKiroAtLocation', 'hooksKiro'],
            ['agentOrganizer.newInstructionAtLocation', 'instructions'],
            ['agentOrganizer.newPluginAtLocation', 'plugins'],
            ['agentOrganizer.newPromptAtLocation', 'prompts'],
        ] as const).map(([cmdId, area]) =>
            vscode.commands.registerCommand(cmdId, async (item: AreaLocationTreeItem) => {
                if (!item) { return; }
                const wf = pathService.getWorkspaceFolderForLocation(item.location);
                const locationUri = pathService.resolveLocationToUri(item.location, wf);
                if (!locationUri) {
                    vscode.window.showErrorMessage('Failed to resolve location.');
                    return;
                }
                await promptAndCreateItem(area, locationUri);
            })
        ),

        // Remove a skill repository from the marketplace
        vscode.commands.registerCommand('agentOrganizer.removeRepository', async (item: SourceTreeItem | FailedSourceTreeItem) => {
            const repo = item instanceof SourceTreeItem ? item.repo : item.failure.repo;

            const repositories = readRepositoriesConfig();
            const updated = repositories.filter(r => !isSameRepository(r, repo));
            // Suppress the config-change full refresh — we handle it incrementally below.
            marketplaceProvider.suppressConfigRefresh();
            try {
                await writeRepositoriesConfig(updated);
                marketplaceProvider.removeRepoFromMarketplace(repo);
                marketplaceProvider.setInstalledSkills(installedProvider.getInstalledSkillNames());
            } catch (e) {
                // Reset suppression so external config changes aren't silently ignored
                marketplaceProvider.shouldHandleConfigChange();
                throw e;
            }
        }),

        // Open a skill repository in the default browser
        vscode.commands.registerCommand('agentOrganizer.openInBrowser', (item: SourceTreeItem | FailedSourceTreeItem | SkillTreeItem | SkillsGroupTreeItem | AreaGroupTreeItem | AreaFileTreeItem) => {
            if (item instanceof SkillTreeItem) {
                const skill = item.skill;
                const url = buildGitHubUrl(skill.source.owner, skill.source.repo, skill.source.branch, skill.skillPath);
                vscode.env.openExternal(vscode.Uri.parse(url));
            } else if (item instanceof SkillsGroupTreeItem || item instanceof AreaGroupTreeItem) {
                const repo = item.parentSource.repo;
                const url = buildGitHubUrl(repo.owner, repo.repo, repo.branch, item.areaPath);
                vscode.env.openExternal(vscode.Uri.parse(url));
            } else if (item instanceof AreaFileTreeItem) {
                const fi = item.fileItem;
                // Use blob URL for files instead of tree URL
                const safeBranch = encodeURIComponent(fi.source.branch);
                const safePath = fi.filePath.split('/').map(encodeURIComponent).join('/');
                const url = `https://github.com/${encodeURIComponent(fi.source.owner)}/${encodeURIComponent(fi.source.repo)}/blob/${safeBranch}/${safePath}`;
                vscode.env.openExternal(vscode.Uri.parse(url));
            } else {
                const repo = item instanceof SourceTreeItem ? item.repo : item.failure.repo;
                const url = buildGitHubUrl(repo.owner, repo.repo, repo.branch, '');
                vscode.env.openExternal(vscode.Uri.parse(url));
            }
        }),

        // Add a new skill repository from a GitHub URL
        vscode.commands.registerCommand('agentOrganizer.addRepository', async () => {
            const input = await vscode.window.showInputBox({
                prompt: 'Enter a GitHub repository URL',
                placeHolder: 'https://github.com/owner/repo',
                validateInput: value => {
                    if (!value?.trim()) { return 'URL is required'; }
                    return parseGitHubUrl(value) ? undefined : 'Could not parse a GitHub repository URL from that input';
                }
            });
            if (!input) { return; }

            const parsed = parseGitHubUrl(input)!;

            // Resolve the actual default branch when it wasn't in the URL
            let branch: string;
            try {
                branch = parsed.branch ?? await githubClient.fetchDefaultBranch(parsed.owner, parsed.repo);
            } catch {
                vscode.window.showErrorMessage('Failed to fetch repository information. Please check the URL and your network connection.');
                return;
            }

            const newRepo: SkillRepository = {
                owner: parsed.owner,
                repo: parsed.repo,
                branch
            };

            const repositories = readRepositoriesConfig();

            const isDuplicate = repositories.some(r => isSameRepository(r, newRepo));
            if (isDuplicate) {
                vscode.window.showWarningMessage(
                    `${newRepo.owner}/${newRepo.repo} is already in the marketplace.`
                );
                return;
            }

            marketplaceProvider.suppressConfigRefresh();
            try {
                await writeRepositoriesConfig([...repositories, newRepo]);
                await marketplaceProvider.addRepoToMarketplace(newRepo);
                marketplaceProvider.setInstalledSkills(installedProvider.getInstalledSkillNames());
                vscode.window.showInformationMessage(`Added ${newRepo.owner}/${newRepo.repo} to the marketplace.`);
            } catch (e) {
                // Reset suppression so external config changes aren't silently ignored
                marketplaceProvider.shouldHandleConfigChange();
                throw e;
            }
        })
    ];

    context.subscriptions.push(...commands, marketplaceTreeView, installedTreeView);

    // ─── Section 7: File watchers & configuration listeners ──────────────

    // ROLLBACK NOTE (Finding 6): Removed redundant SKILL.md watchers that duplicated
    // installedProvider.createFileWatchers() coverage. If skills stop auto-detecting
    // new installs, restore the following block:
    //
    //   const workspaceScanLocations = pathService.getScanLocations()
    //       .filter(loc => !pathService.isHomeLocation(loc));
    //   const skillWatchers = workspaceScanLocations.map(loc => {
    //       const normalizedLoc = normalizeSeparators(loc);
    //       const watcher = vscode.workspace.createFileSystemWatcher(`**/${normalizedLoc}/*/SKILL.md`);
    //       watcher.onDidCreate(() => syncInstalledStatus());
    //       watcher.onDidDelete(() => syncInstalledStatus());
    //       return watcher;
    //   });
    //   context.subscriptions.push(...skillWatchers);

    // Watch all scan locations for file changes to refresh duplicate status icons.
    // Initial watchers are created here; recreated internally on refresh.
    // The provider itself is registered as a disposable to clean up on deactivation.
    installedProvider.createFileWatchers();
    context.subscriptions.push(installedProvider);

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('agentOrganizer.skillRepositories')) {
                if (marketplaceProvider.shouldHandleConfigChange()) {
                    // External/manual config change — do a full refresh.
                    marketplaceProvider.refresh().then(() => {
                        marketplaceProvider.setInstalledSkills(installedProvider.getInstalledSkillNames());
                    });
                }
            }
            if (e.affectsConfiguration('chat.agentSkillsLocations')) {
                // Scan locations changed — full refresh recreates watchers automatically
                syncInstalledStatus();
            }
        })
    );

    // ─── Section 8: Startup & initial load ─────────────────────────────

    // Ensure per-area install locations are persisted in settings
    pathService.ensureInstallLocations();

    // Initial load - load installed skills, preload area providers, and marketplace in parallel.
    // preload() populates item data for green checks without clearing the loading state,
    // so area views still show the spinner when first expanded.
    Promise.all([
        installedProvider.refresh(),
        ...Array.from(areaProviders.values()).map(p => p.preload()),
        marketplaceProvider.loadSkills()
    ]).then(() => {
        // Collect all installed names across skills and area providers
        const allNames = new Set(installedProvider.getInstalledSkillNames());
        for (const provider of areaProviders.values()) {
            for (const item of provider.getInstalledItems()) {
                allNames.add(item.name);
            }
        }
        marketplaceProvider.setInstalledSkills(installedProvider.getInstalledSkillNames());
        marketplaceProvider.setInstalledItemNames(allNames);
    });
}

export function deactivate() {}
