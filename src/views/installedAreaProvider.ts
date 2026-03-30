/**
 * Generic Installed Area TreeDataProvider — displays installed items for any content area.
 * Reuses the same scan/display pattern as the Skills view but parameterized by area type.
 */

import * as vscode from 'vscode';
import { InstalledSkill, normalizeSeparators, ContentArea, AREA_DEFINITIONS } from '../types';
import { SkillPathService } from '../services/skillPathService';
import { DuplicateStatus, computeAllDuplicateStatuses, createLocationWatchers, FileInfo } from '../services/duplicateService';

type TreeNode = AreaLocationTreeItem | AreaInstalledItemTreeItem | AreaItemFolderTreeItem | AreaItemFileTreeItem;

let extensionUri: vscode.Uri | undefined;

export function initializeAreaIcons(context: vscode.ExtensionContext): void {
    extensionUri = context.extensionUri;
}

function getAreaItemIcon(area: ContentArea, status: 'unique' | 'newest' | 'older' | 'same' = 'unique'): vscode.Uri | vscode.ThemeIcon {
    if (!extensionUri) { return new vscode.ThemeIcon('extensions'); }
    const iconPrefix = AREA_DEFINITIONS[area].iconPrefix || area;
    const colorMap = { unique: '', newest: '-green', older: '-orange', same: '-blue' };
    return vscode.Uri.joinPath(extensionUri, 'resources', `${iconPrefix}-icon${colorMap[status]}.svg`);
}

function getFolderIcon(): vscode.Uri | vscode.ThemeIcon {
    if (!extensionUri) { return new vscode.ThemeIcon('folder'); }
    return vscode.Uri.joinPath(extensionUri, 'resources', 'folder.svg');
}

export class AreaLocationTreeItem extends vscode.TreeItem {
    constructor(
        public readonly location: string,
        public readonly items: InstalledSkill[],
        collapsibleState = vscode.TreeItemCollapsibleState.Collapsed
    ) {
        super(location, collapsibleState);
        this.tooltip = `${items.length} item${items.length !== 1 ? 's' : ''}`;
        this.iconPath = getFolderIcon();
        this.contextValue = 'areaLocation';
    }
}

export class AreaInstalledItemTreeItem extends vscode.TreeItem {
    constructor(
        public readonly installedItem: InstalledSkill,
        public readonly itemUri: vscode.Uri,
        public readonly area: ContentArea,
        public readonly isSingleFile: boolean = false,
        status: 'unique' | 'newest' | 'older' | 'same' = 'unique'
    ) {
        super(installedItem.name, isSingleFile ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed);
        this.description = installedItem.description;
        this.iconPath = getAreaItemIcon(area, status);
        // Encode duplicate status into contextValue so menu visibility can key off it
        const base = isSingleFile ? 'areaInstalledFile' : 'areaInstalledFolder';
        this.contextValue = status === 'newest' ? `${base}_newest`
            : status === 'older' ? `${base}_older`
            : base;

        // Single-file items open in editor on click
        if (isSingleFile) {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [itemUri]
            };
        }
    }
}

export class AreaItemFolderTreeItem extends vscode.TreeItem {
    constructor(
        public readonly folderUri: vscode.Uri,
        public readonly folderName: string,
        public readonly parentItem: AreaInstalledItemTreeItem | AreaItemFolderTreeItem
    ) {
        super(folderName, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = getFolderIcon();
        this.contextValue = 'areaItemFolder';
    }
}

export class AreaItemFileTreeItem extends vscode.TreeItem {
    constructor(
        public readonly fileUri: vscode.Uri,
        public readonly fileName: string,
        public readonly parentFolder: AreaItemFolderTreeItem | AreaInstalledItemTreeItem
    ) {
        super(fileName, vscode.TreeItemCollapsibleState.None);
        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [fileUri]
        };
        this.iconPath = new vscode.ThemeIcon('file');
        this.contextValue = 'areaItemFile';
    }
}

export class InstalledAreaTreeDataProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private installedItems: InstalledSkill[] = [];
    private initialLoading = true;
    private initialScanStarted = false;
    private searchQuery = '';
    private activeWatchers: vscode.Disposable[] = [];
    private treeView?: vscode.TreeView<TreeNode>;
    /** Mutex: if a scan is in progress, all callers share this single promise. */
    private pendingScan: Promise<InstalledSkill[]> | null = null;
    /** Whether loadItems has completed at least once (cache is warm). */
    private cacheReady = false;
    /** Duplicate status per item location */
    private duplicateStatusMap = new Map<string, DuplicateStatus>();
    /** Persisted collapsed state for location groups */
    private collapsedLocations: Set<string>;
    private readonly collapsedStateKey: string;
    /** Cached location tree items for getParent/reveal support */
    private locationItems = new Map<string, AreaLocationTreeItem>();
    /** Debounce timer for file change events */
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private pendingRefresh = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly pathService: SkillPathService,
        private readonly area: ContentArea,
        private readonly viewId: string
    ) {
        this.collapsedStateKey = `${viewId}.collapsedLocations`;
        this.collapsedLocations = new Set(
            this.context.workspaceState.get<string[]>(this.collapsedStateKey, [])
        );
        this.createFileWatchers();
    }

    /**
     * Scan and cache items. Uses a mutex so concurrent callers share a single scan.
     * If the cache is already warm, returns the cached results immediately.
     * Pass force=true to bypass the cache (used by refresh).
     */
    private async loadItems(force = false): Promise<InstalledSkill[]> {
        // Return cached results if available and not forced
        if (this.cacheReady && !force) {
            return this.installedItems;
        }

        // If a scan is already in progress, piggyback on it
        if (this.pendingScan) {
            return this.pendingScan;
        }

        // Start a new scan
        this.pendingScan = this.scanInstalledItems().then(items => {
            this.installedItems = items;
            this.cacheReady = true;
            this.pendingScan = null;
            return items;
        });

        return this.pendingScan;
    }

    /**
     * Pre-populate installed items in the background (called at startup).
     * Does NOT clear the loading state so getChildren() still shows the spinner
     * when the view is first expanded.
     */
    async preload(): Promise<void> {
        await this.loadItems();
        await this.computeDuplicateStatuses();
    }

    /**
     * Kick off the initial scan (called lazily from getChildren on first access).
     * If preload already cached results, this completes instantly.
     * Shows the spinner, then replaces it with results.
     */
    private startInitialScan(): void {
        if (this.initialScanStarted) { return; }
        this.initialScanStarted = true;
        this.loadItems().then(async () => {
            await this.computeDuplicateStatuses();
            this.initialLoading = false;
            await vscode.commands.executeCommand('setContext', `${this.viewId}:initialScanComplete`, true);
            this._onDidChangeTreeData.fire();
        });
    }

    /**
     * Full refresh — forces a new scan, clears loading state, updates the tree.
     */
    async refresh(): Promise<void> {
        this.initialScanStarted = true;
        await this.loadItems(true);
        await this.computeDuplicateStatuses();
        this.initialLoading = false;
        this.recreateFileWatchers();
        await vscode.commands.executeCommand('setContext', `${this.viewId}:initialScanComplete`, true);
        this._onDidChangeTreeData.fire();
    }

    setTreeView(treeView: vscode.TreeView<TreeNode>): void {
        this.treeView = treeView;
        treeView.onDidCollapseElement(e => {
            if (e.element instanceof AreaLocationTreeItem) {
                this.collapsedLocations.add(e.element.location);
                this.saveCollapsedState();
            }
        });
        treeView.onDidExpandElement(e => {
            if (e.element instanceof AreaLocationTreeItem) {
                this.collapsedLocations.delete(e.element.location);
                this.saveCollapsedState();
            }
        });
    }

    private async saveCollapsedState(): Promise<void> {
        await this.context.workspaceState.update(
            this.collapsedStateKey,
            Array.from(this.collapsedLocations)
        );
    }

    async expandAll(): Promise<void> {
        this.collapsedLocations.clear();
        await this.saveCollapsedState();
        if (!this.treeView) { return; }
        const root = await this.getChildren();
        if (!root) { return; }
        for (const node of root) {
            if (node instanceof AreaLocationTreeItem) {
                try {
                    await this.treeView.reveal(node, { expand: true });
                } catch { /* ignore */ }
            }
        }
    }

    async collapseAll(): Promise<void> {
        const groups = this.groupByLocation();
        for (const location of Object.keys(groups)) {
            this.collapsedLocations.add(location);
        }
        await this.saveCollapsedState();
        this._onDidChangeTreeData.fire();
    }

    getInstalledItemNames(): Set<string> {
        return new Set(this.installedItems.map(s => s.name));
    }

    getInstalledItems(): InstalledSkill[] {
        return this.installedItems;
    }

    /**
     * Get the duplicate status for a given item location.
     */
    getDuplicateStatus(location: string): DuplicateStatus {
        return this.duplicateStatusMap.get(location) || 'unique';
    }

    /**
     * Find the newest copy of an item by name (status === 'newest').
     */
    findNewestCopy(itemName: string): InstalledSkill | undefined {
        return this.installedItems.find(
            i => i.name === itemName && this.duplicateStatusMap.get(i.location) === 'newest'
        );
    }

    setSearchQuery(query: string): void {
        this.searchQuery = query.toLowerCase();
        this._onDidChangeTreeData.fire();
        vscode.commands.executeCommand('setContext', `${this.viewId}:searchActive`, this.searchQuery.length > 0);
    }

    clearSearch(): void {
        this.searchQuery = '';
        this._onDidChangeTreeData.fire();
        vscode.commands.executeCommand('setContext', `${this.viewId}:searchActive`, false);
    }

    private getFilteredItems(): InstalledSkill[] {
        if (!this.searchQuery) { return this.installedItems; }
        return this.installedItems.filter(s =>
            s.name.toLowerCase().includes(this.searchQuery) ||
            s.description.toLowerCase().includes(this.searchQuery)
        );
    }

    private groupByLocation(items?: InstalledSkill[]): Record<string, InstalledSkill[]> {
        const list = items || this.installedItems;
        const groups: Record<string, InstalledSkill[]> = {};
        for (const item of list) {
            // Strip the item name from the end of location to get the parent scan location
            const loc = item.location;
            const parentLoc = loc.includes('/') ? loc.substring(0, loc.lastIndexOf('/')) : loc;
            if (!groups[parentLoc]) { groups[parentLoc] = []; }
            groups[parentLoc].push(item);
        }
        return groups;
    }

    /**
     * Compute duplicate statuses for all installed items using the shared duplicate service.
     */
    private async computeDuplicateStatuses(): Promise<void> {
        const fs = this.pathService.getFileSystem();
        const def = AREA_DEFINITIONS[this.area];

        const resolveUri = (item: InstalledSkill): vscode.Uri | undefined => {
            const loc = normalizeSeparators(item.location);
            const workspaceFolder = this.pathService.getWorkspaceFolderForLocation(loc);
            return this.pathService.resolveLocationToUri(loc, workspaceFolder);
        };

        const collectFn = async (uri: vscode.Uri): Promise<FileInfo[]> => {
            if (def.kind === 'singleFile') {
                // Single-file: one file entry with content and mtime
                try {
                    const content = new TextDecoder().decode(await fs.readFile(uri));
                    const stat = await fs.stat(uri);
                    return [{ relativePath: '', mtime: stat.mtime, content }];
                } catch { return []; }
            } else if (def.definitionFile) {
                // Multi-file: compare the definition file
                const defFileUri = await this.findDefinitionFile(uri, def.definitionFile);
                if (!defFileUri) { return []; }
                try {
                    const content = new TextDecoder().decode(await fs.readFile(defFileUri));
                    const stat = await fs.stat(defFileUri);
                    return [{ relativePath: def.definitionFile, mtime: stat.mtime, content }];
                } catch { return []; }
            }
            return [];
        };

        this.duplicateStatusMap = await computeAllDuplicateStatuses(
            this.installedItems, resolveUri, collectFn
        );
    }

    async scanInstalledItems(): Promise<InstalledSkill[]> {
        const def = AREA_DEFINITIONS[this.area];
        const fs = this.pathService.getFileSystem();
        const items: InstalledSkill[] = [];

        // Get scan locations from the area's own chat.* setting (or generated defaults)
        const areaLocationsSet = new Set<string>(
            this.pathService.getDefaultDownloadLocations(this.area).map(normalizeSeparators)
        );

        // Also include the configured default download location for this area
        const defaultDownload = normalizeSeparators(this.pathService.getDefaultDownloadLocation(this.area));
        areaLocationsSet.add(defaultDownload);

        for (const areaLocation of areaLocationsSet) {
            const workspaceFolder = this.pathService.getWorkspaceFolderForLocation(areaLocation);
            if (this.pathService.requiresWorkspaceFolder(areaLocation) && !workspaceFolder) { continue; }

            const areaUri = this.pathService.resolveLocationToUri(areaLocation, workspaceFolder);
            if (!areaUri) { continue; }

            try {
                await fs.stat(areaUri);
            } catch {
                continue; // Directory doesn't exist
            }

            if (def.kind === 'multiFile' && def.definitionFile) {
                try {
                    const entries = await fs.readDirectory(areaUri);
                    for (const [name, type] of entries) {
                        if (type !== vscode.FileType.Directory) { continue; }
                        const itemUri = vscode.Uri.joinPath(areaUri, name);
                        // Search recursively for the definition file (it may be nested)
                        const defFileUri = await this.findDefinitionFile(itemUri, def.definitionFile);
                        if (!defFileUri) { continue; }
                        try {
                            const metadata = await this.parseDefinitionFile(defFileUri, def.definitionFile);
                            items.push({
                                name: metadata.name || name,
                                description: metadata.description || '',
                                location: normalizeSeparators(`${areaLocation}/${name}`),
                                installedAt: new Date().toISOString()
                            });
                        } catch {
                            // Can't parse definition file, skip
                        }
                    }
                } catch {
                    // Can't read directory
                }
            } else if (def.kind === 'singleFile' && def.fileSuffix) {
                try {
                    await this.scanSingleFiles(areaUri, areaLocation, def.fileSuffix, items);
                } catch {
                    // Can't read directory
                }
            }
        }

        return items;
    }

    private async scanSingleFiles(dirUri: vscode.Uri, baseLoc: string, suffix: string, items: InstalledSkill[]): Promise<void> {
        const fs = this.pathService.getFileSystem();
        const entries = await fs.readDirectory(dirUri);
        for (const [name, type] of entries) {
            if (type === vscode.FileType.Directory) {
                // Recurse into subdirectories
                const subUri = vscode.Uri.joinPath(dirUri, name);
                await this.scanSingleFiles(subUri, `${baseLoc}/${name}`, suffix, items);
            } else if (type === vscode.FileType.File && name.endsWith(suffix)) {
                const itemName = name.substring(0, name.length - suffix.length);
                const normalizedLoc = normalizeSeparators(`${baseLoc}/${name}`);
                items.push({
                    name: itemName,
                    description: '',
                    location: normalizedLoc,
                    installedAt: new Date().toISOString()
                });
            }
        }
    }

    /**
     * Recursively search for a definition file within a directory.
     * Returns the URI of the first match, or undefined if not found.
     */
    private async findDefinitionFile(dirUri: vscode.Uri, fileName: string): Promise<vscode.Uri | undefined> {
        const fs = this.pathService.getFileSystem();
        const rootFile = vscode.Uri.joinPath(dirUri, fileName);
        try {
            await fs.stat(rootFile);
            return rootFile;
        } catch { /* not at root */ }

        try {
            const entries = await fs.readDirectory(dirUri);
            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory) {
                    const found = await this.findDefinitionFile(vscode.Uri.joinPath(dirUri, name), fileName);
                    if (found) { return found; }
                }
            }
        } catch { /* ignore */ }
        return undefined;
    }

    private async parseDefinitionFile(uri: vscode.Uri, fileName: string): Promise<{ name: string; description: string }> {
        const fs = this.pathService.getFileSystem();
        const content = new TextDecoder().decode(await fs.readFile(uri));

        if (fileName.endsWith('.json')) {
            try {
                const json = JSON.parse(content);
                return { name: json.name || '', description: json.description || '' };
            } catch {
                return { name: '', description: '' };
            }
        }

        // Parse YAML frontmatter for .md files
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!match) { return { name: '', description: '' }; }

        let name = '';
        let description = '';
        for (const line of match[1].split('\n')) {
            const [key, ...rest] = line.split(':');
            const value = rest.join(':').trim().replace(/^['"]|['"]$/g, '');
            if (key.trim() === 'name') { name = value; }
            if (key.trim() === 'description') { description = value; }
        }
        return { name, description };
    }

    // --- Tree data provider ---

    getTreeItem(element: TreeNode): vscode.TreeItem {
        if (element instanceof AreaLocationTreeItem) {
            element.collapsibleState = this.collapsedLocations.has(element.location)
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.Expanded;
        }
        return element;
    }

    getParent(element: TreeNode): vscode.ProviderResult<TreeNode> {
        if (element instanceof AreaItemFileTreeItem) { return element.parentFolder; }
        if (element instanceof AreaItemFolderTreeItem) { return element.parentItem; }
        if (element instanceof AreaInstalledItemTreeItem) {
            const loc = element.installedItem.location;
            const parentLoc = loc.includes('/') ? loc.substring(0, loc.lastIndexOf('/')) : loc;
            return this.locationItems.get(parentLoc);
        }
        return undefined;
    }

    getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]> {
        if (element instanceof AreaItemFileTreeItem) { return []; }

        if (element instanceof AreaItemFolderTreeItem) {
            return this.listFolderContents(element.folderUri, element);
        }

        if (element instanceof AreaInstalledItemTreeItem) {
            if (element.isSingleFile) { return []; }
            return this.listFolderContents(element.itemUri, element);
        }

        if (element instanceof AreaLocationTreeItem) {
            const def = AREA_DEFINITIONS[this.area];
            const isSingleFile = def.kind === 'singleFile';
            return element.items.map(item => {
                const normalizedLoc = normalizeSeparators(item.location);
                const lastSlash = normalizedLoc.lastIndexOf('/');
                const parentLoc = lastSlash > 0 ? normalizedLoc.substring(0, lastSlash) : normalizedLoc;
                const itemName = normalizedLoc.substring(lastSlash + 1);

                const workspaceFolder = this.pathService.getWorkspaceFolderForLocation(parentLoc);
                const parentUri = this.pathService.resolveLocationToUri(parentLoc, workspaceFolder);
                const itemUri = parentUri ? vscode.Uri.joinPath(parentUri, itemName) : vscode.Uri.file(item.location);
                return new AreaInstalledItemTreeItem(item, itemUri, this.area, isSingleFile,
                    this.duplicateStatusMap.get(item.location) || 'unique');
            });
        }

        // Root level
        if (this.initialLoading) {
            // If cache is warm (preload completed), use cached data directly — no spinner needed
            if (this.cacheReady) {
                this.initialLoading = false;
                this.initialScanStarted = true;
                vscode.commands.executeCommand('setContext', `${this.viewId}:initialScanComplete`, true);
                // Fall through to render the data below
            } else {
                // Cache not ready — show spinner and kick off scan
                this.startInitialScan();
                const areaLabel = AREA_DEFINITIONS[this.area].label.toLowerCase();
                const loading = new vscode.TreeItem(`Searching for installed ${areaLabel}...`, vscode.TreeItemCollapsibleState.None);
                loading.iconPath = new vscode.ThemeIcon('loading~spin');
                return [loading as unknown as TreeNode];
            }
        }

        const filtered = this.getFilteredItems();
        if (filtered.length === 0 && this.searchQuery) {
            const noResults = new vscode.TreeItem(`No results for "${this.searchQuery}"`, vscode.TreeItemCollapsibleState.None);
            noResults.iconPath = new vscode.ThemeIcon('search-stop');
            return [noResults as unknown as TreeNode];
        }

        if (filtered.length === 0) { return []; }

        const groups = this.groupByLocation(filtered);
        const nextLocationItems = new Map<string, AreaLocationTreeItem>();
        const result = Object.entries(groups).map(([location, items]) => {
            const collapsibleState = this.collapsedLocations.has(location)
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.Expanded;
            const item = new AreaLocationTreeItem(location, items, collapsibleState);
            nextLocationItems.set(location, item);
            return item;
        });
        this.locationItems = nextLocationItems;
        return result;
    }

    private async listFolderContents(folderUri: vscode.Uri, parent: AreaInstalledItemTreeItem | AreaItemFolderTreeItem): Promise<TreeNode[]> {
        const fs = this.pathService.getFileSystem();
        try {
            const entries = await fs.readDirectory(folderUri);
            const children: TreeNode[] = [];
            const sorted = [...entries].sort(([a, aType], [b, bType]) => {
                if (aType !== bType) { return aType === vscode.FileType.Directory ? -1 : 1; }
                return a.localeCompare(b);
            });
            for (const [name, type] of sorted) {
                const childUri = vscode.Uri.joinPath(folderUri, name);
                if (type === vscode.FileType.Directory) {
                    children.push(new AreaItemFolderTreeItem(childUri, name, parent as AreaInstalledItemTreeItem | AreaItemFolderTreeItem));
                } else {
                    children.push(new AreaItemFileTreeItem(childUri, name, parent));
                }
            }
            return children;
        } catch {
            return [];
        }
    }

    // --- File watchers ---

    createFileWatchers(): void {
        const def = AREA_DEFINITIONS[this.area];

        // Use the area's own scan locations (from chat.* setting or generated defaults)
        const areaLocsSet = new Set<string>(
            this.pathService.getDefaultDownloadLocations(this.area).map(normalizeSeparators)
        );
        const defaultDownload = normalizeSeparators(this.pathService.getDefaultDownloadLocation(this.area));
        areaLocsSet.add(defaultDownload);

        // Determine the file pattern for this area
        let filePattern: string;
        if (def.kind === 'multiFile' && def.definitionFile) {
            filePattern = `**/${def.definitionFile}`;
        } else {
            filePattern = `**/*${def.fileSuffix}`;
        }

        const watchers = createLocationWatchers(
            [...areaLocsSet], this.pathService, filePattern,
            () => this.onFileChanged()
        );
        this.activeWatchers.push(...watchers);
    }

    /**
     * Debounced file change handler — waits 500ms for rapid successive changes.
     */
    private onFileChanged(): void {
        this.pendingRefresh = true;
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
        this.debounceTimer = setTimeout(async () => {
            if (this.pendingRefresh) {
                this.pendingRefresh = false;
                await this.refresh();
            }
        }, 500);
    }

    private recreateFileWatchers(): void {
        for (const w of this.activeWatchers) { w.dispose(); }
        this.activeWatchers = [];
        this.createFileWatchers();
    }

    dispose(): void {
        for (const w of this.activeWatchers) { w.dispose(); }
        this.activeWatchers = [];
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
        this._onDidChangeTreeData.dispose();
    }
}
