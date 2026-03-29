/**
 * Shared duplicate detection and file watcher utilities.
 * Used by both InstalledSkillsTreeDataProvider and InstalledAreaTreeDataProvider.
 */

import * as vscode from 'vscode';
import { InstalledSkill, normalizeSeparators } from '../types';
import { SkillPathService } from './skillPathService';

// ─── Duplicate status type ───────────────────────────────────────────────────

export type DuplicateStatus = 'unique' | 'newest' | 'older' | 'same';

// ─── File info for comparison ────────────────────────────────────────────────

export interface FileInfo {
    relativePath: string;
    mtime: number;
    /** Text content for text-based files; undefined for binary files */
    content?: string;
}

/** Extensions considered text-based for content comparison */
const TEXT_EXTENSIONS = new Set([
    '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml', '.html', '.htm',
    '.css', '.scss', '.less', '.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.rs',
    '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.sh', '.bash', '.zsh',
    '.ps1', '.psm1', '.psd1', '.bat', '.cmd', '.cfg', '.ini', '.conf', '.env',
    '.gitignore', '.editorconfig', '.prettierrc', '.eslintrc', '.svg', '.csv',
]);

// ─── File collection ─────────────────────────────────────────────────────────

/**
 * Recursively collect file info (path, mtime, text content) from a directory.
 * Used for multi-file duplicate comparison.
 * @param rootUri The root directory to scan
 * @param fs The filesystem to use
 * @param priorityFile Optional file to sort first (e.g. 'SKILL.md')
 */
export async function collectFileInfos(
    rootUri: vscode.Uri,
    fs: vscode.FileSystem,
    priorityFile?: string
): Promise<FileInfo[]> {
    const results: FileInfo[] = [];

    const walk = async (dir: vscode.Uri, prefix: string) => {
        try {
            const entries = await fs.readDirectory(dir);
            for (const [name, type] of entries) {
                const childUri = vscode.Uri.joinPath(dir, name);
                const relativePath = prefix ? `${prefix}/${name}` : name;
                if ((type & vscode.FileType.Directory) !== 0) {
                    await walk(childUri, relativePath);
                } else {
                    const stat = await fs.stat(childUri);
                    const info: FileInfo = { relativePath, mtime: stat.mtime };

                    const ext = name.includes('.') ? name.substring(name.lastIndexOf('.')).toLowerCase() : '';
                    if (TEXT_EXTENSIONS.has(ext) || name.startsWith('.')) {
                        try {
                            const bytes = await fs.readFile(childUri);
                            info.content = new TextDecoder().decode(bytes);
                        } catch { /* fall back to mtime only */ }
                    }

                    results.push(info);
                }
            }
        } catch { /* skip unreadable dirs */ }
    };

    await walk(rootUri, '');

    results.sort((a, b) => {
        if (priorityFile) {
            if (a.relativePath === priorityFile) { return -1; }
            if (b.relativePath === priorityFile) { return 1; }
        }
        return a.relativePath.localeCompare(b.relativePath);
    });

    return results;
}

// ─── File comparison ─────────────────────────────────────────────────────────

/**
 * Compare two sets of file infos.
 * Returns: 1 if A is newer, -1 if B is newer, 0 if same.
 *
 * For each shared file:
 *  1. If both have text content and it matches, the file is equivalent (skip date check)
 *  2. Otherwise compare by mtime
 *  3. If all shared files are equivalent, the copy with extra files is newer
 */
export function compareFiles(filesA: FileInfo[], filesB: FileInfo[]): number {
    const mapA = new Map(filesA.map(f => [f.relativePath, f]));
    const mapB = new Map(filesB.map(f => [f.relativePath, f]));

    const allPaths = new Set<string>();
    for (const f of filesA) { allPaths.add(f.relativePath); }
    for (const f of filesB) { allPaths.add(f.relativePath); }
    const sorted = [...allPaths].sort();

    let extraA = 0;
    let extraB = 0;

    for (const p of sorted) {
        const fileA = mapA.get(p);
        const fileB = mapB.get(p);

        if (fileA && fileB) {
            if (fileA.content !== undefined && fileB.content !== undefined
                && fileA.content === fileB.content) {
                continue;
            }
            // When mtimes are equal but content wasn't compared (e.g. binary files or
            // mixed text/binary), we treat the files as equivalent. There isn't enough
            // information to determine a meaningful difference without content comparison.
            if (fileA.mtime > fileB.mtime) { return 1; }
            if (fileA.mtime < fileB.mtime) { return -1; }
        } else if (fileA && !fileB) {
            extraA++;
        } else {
            extraB++;
        }
    }

    if (extraA > extraB) { return 1; }
    if (extraA < extraB) { return -1; }

    if (extraA > 0 || extraB > 0) {
        const pathsA = [...mapA.keys()].sort().join('\0');
        const pathsB = [...mapB.keys()].sort().join('\0');
        const cmp = pathsA.localeCompare(pathsB);
        if (cmp !== 0) { return cmp > 0 ? 1 : -1; }
    }

    return 0;
}

// ─── Duplicate status computation ────────────────────────────────────────────

export interface DuplicateCopy {
    item: InstalledSkill;
    files: FileInfo[];
}

/**
 * Compute duplicate statuses for a group of items that share the same name.
 * Returns a map of location → status.
 */
export function computeGroupStatus(copies: DuplicateCopy[]): Map<string, DuplicateStatus> {
    const result = new Map<string, DuplicateStatus>();

    if (copies.length < 2) {
        for (const { item } of copies) {
            result.set(item.location, 'unique');
        }
        return result;
    }

    // Check if all copies are identical
    let allSame = true;
    for (let i = 1; i < copies.length; i++) {
        if (compareFiles(copies[0].files, copies[i].files) !== 0) {
            allSame = false;
            break;
        }
    }

    if (allSame) {
        for (const { item } of copies) {
            result.set(item.location, 'same');
        }
    } else {
        let newestIdx = 0;
        for (let i = 1; i < copies.length; i++) {
            if (compareFiles(copies[i].files, copies[newestIdx].files) > 0) {
                newestIdx = i;
            }
        }
        for (let i = 0; i < copies.length; i++) {
            result.set(copies[i].item.location, i === newestIdx ? 'newest' : 'older');
        }
    }

    return result;
}

/**
 * Compute duplicate statuses for all items, grouped by name.
 * @param items All installed items
 * @param resolveUri Function to resolve an item's location to a URI
 * @param collectFn Function to collect file infos for a URI
 */
export async function computeAllDuplicateStatuses(
    items: InstalledSkill[],
    resolveUri: (item: InstalledSkill) => vscode.Uri | undefined,
    collectFn: (uri: vscode.Uri) => Promise<FileInfo[]>
): Promise<Map<string, DuplicateStatus>> {
    const statusMap = new Map<string, DuplicateStatus>();

    // Group by name
    const byName = new Map<string, InstalledSkill[]>();
    for (const item of items) {
        const list = byName.get(item.name) || [];
        list.push(item);
        byName.set(item.name, list);
    }

    for (const [, group] of byName) {
        if (group.length === 1) {
            statusMap.set(group[0].location, 'unique');
            continue;
        }

        const copies: DuplicateCopy[] = [];
        for (const item of group) {
            const uri = resolveUri(item);
            if (uri) {
                copies.push({ item, files: await collectFn(uri) });
            }
        }

        if (copies.length < 2) {
            for (const item of group) {
                statusMap.set(item.location, 'unique');
            }
            continue;
        }

        const groupStatuses = computeGroupStatus(copies);
        for (const [loc, status] of groupStatuses) {
            statusMap.set(loc, status);
        }
    }

    return statusMap;
}

// ─── File watcher creation ───────────────────────────────────────────────────

/**
 * Create file system watchers for a set of locations.
 * Handles both home directory (using RelativePattern) and workspace-relative locations.
 *
 * @param locations Array of location strings to watch
 * @param pathService The path service for resolving locations
 * @param filePattern Glob pattern for files to watch (e.g. '**\/*' or '**\/*.agent.md')
 * @param onEvent Callback when any file event occurs
 */
export function createLocationWatchers(
    locations: string[],
    pathService: SkillPathService,
    filePattern: string,
    onEvent: (uri: vscode.Uri) => void
): vscode.Disposable[] {
    const watchers: vscode.Disposable[] = [];

    for (const location of locations) {
        if (pathService.isHomeLocation(location)) {
            const uri = pathService.resolveLocationToUri(location);
            if (uri) {
                const watcher = vscode.workspace.createFileSystemWatcher(
                    new vscode.RelativePattern(uri, filePattern)
                );
                watcher.onDidCreate(onEvent);
                watcher.onDidChange(onEvent);
                watcher.onDidDelete(onEvent);
                watchers.push(watcher);
            }
        } else {
            const normalizedLoc = normalizeSeparators(location);
            const watcher = vscode.workspace.createFileSystemWatcher(`**/${normalizedLoc}/${filePattern}`);
            watcher.onDidCreate(onEvent);
            watcher.onDidChange(onEvent);
            watcher.onDidDelete(onEvent);
            watchers.push(watcher);
        }
    }

    return watchers;
}
