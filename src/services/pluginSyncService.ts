/**
 * Plugin Sync Service — handles "Get latest copy" operations for plugin subfolders.
 *
 * Plugins can contain subfolders that mirror content areas:
 *   /agents   → agents area
 *   /skills   → skills area
 *   /commands → prompts area
 *   /hooks    → hooks-github area
 *
 * "Get latest" finds the newest version of each item from the installed area views
 * and overwrites the plugin's copy.
 */

import * as vscode from 'vscode';
import { InstalledSkill, normalizeSeparators, ContentArea } from '../types';

/** Maps plugin subfolder names to their source content area */
export const PLUGIN_SUBFOLDER_TO_AREA: Record<string, ContentArea> = {
    'agents': 'agents',
    'skills': 'skills',
    'commands': 'prompts',
    'hooks': 'hooksGithub',
};

/** Maps content areas to their plugin subfolder name */
export const AREA_TO_PLUGIN_SUBFOLDER: Partial<Record<ContentArea, string>> = {
    agents: 'agents',
    skills: 'skills',
    prompts: 'commands',
    hooksGithub: 'hooks',
};

/** The subfolder names that are recognized as AI tool areas inside a plugin */
export const PLUGIN_AREA_SUBFOLDERS = Object.keys(PLUGIN_SUBFOLDER_TO_AREA);

/**
 * Find the latest installed copy of an item by name from the given area's installed items.
 * For single-file areas, matches by file name (without suffix).
 * For multi-file areas, matches by folder name.
 */
export function findLatestCopy(
    itemName: string,
    areaItems: InstalledSkill[]
): InstalledSkill | undefined {
    // Find all copies with the same name
    const matches = areaItems.filter(i => i.name === itemName);
    if (matches.length === 0) { return undefined; }
    // Return the first match (the area provider already tracks newest via duplicate status)
    return matches[0];
}

/** Result of a plugin item sync attempt */
export interface SyncResult {
    updated: boolean;
    reason?: string;
}

/**
 * Sync a single item inside a plugin subfolder with the latest version from the area.
 * @param itemUri URI of the item inside the plugin (file or folder)
 * @param itemName Name to search for in the area
 * @param areaItems All installed items from the source area
 * @param resolveItemUri Function to resolve an item's location to a URI
 * @returns SyncResult with updated status and reason if not updated
 */
export async function syncPluginItem(
    itemUri: vscode.Uri,
    itemName: string,
    areaItems: InstalledSkill[],
    resolveItemUri: (item: InstalledSkill) => vscode.Uri | undefined
): Promise<SyncResult> {
    const source = findLatestCopy(itemName, areaItems);
    if (!source) { return { updated: false, reason: 'no matching item found' }; }

    const sourceUri = resolveItemUri(source);
    if (!sourceUri) { return { updated: false, reason: 'could not resolve source location' }; }

    try {
        // Delete the old copy and replace with the latest
        try {
            await vscode.workspace.fs.delete(itemUri, { recursive: true, useTrash: true });
        } catch { /* didn't exist */ }
        await vscode.workspace.fs.copy(sourceUri, itemUri, { overwrite: true });
        return { updated: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { updated: false, reason: `copy failed: ${message}` };
    }
}

/**
 * Resolve an InstalledSkill's location to a URI.
 */
export function resolveInstalledItemUri(
    item: InstalledSkill,
    pathService: { getWorkspaceFolderForLocation(loc: string): vscode.WorkspaceFolder | undefined; resolveLocationToUri(loc: string, wf?: vscode.WorkspaceFolder): vscode.Uri | undefined }
): vscode.Uri | undefined {
    const loc = normalizeSeparators(item.location);
    const wf = pathService.getWorkspaceFolderForLocation(loc);
    return pathService.resolveLocationToUri(loc, wf);
}
