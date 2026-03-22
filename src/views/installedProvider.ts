/**
 * Installed Skills TreeDataProvider - displays skills installed in the workspace
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { InstalledSkill, SkillMetadata, normalizeSeparators } from '../types';
import { SkillPathService } from '../services/skillPathService';

type TreeNode = LocationTreeItem | InstalledSkillTreeItem | SkillFolderTreeItem | SkillFileTreeItem;

/** Duplicate status for a skill relative to other copies with the same name */
export type SkillDuplicateStatus = 'unique' | 'newest' | 'older' | 'same';

let folderIconUri: vscode.Uri | undefined;
// Icon URIs keyed by duplicate status
let skillIconUris: Record<SkillDuplicateStatus, vscode.Uri> | undefined;

/**
 * Initialize icons from extension resources
 */
export function initializeIcons(context: vscode.ExtensionContext): void {
    if (!context.extensionUri) {
        return;
    }
    folderIconUri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'folder.svg');
    skillIconUris = {
        unique: vscode.Uri.joinPath(context.extensionUri, 'resources', 'skills-icon-purple.svg'),
        older:  vscode.Uri.joinPath(context.extensionUri, 'resources', 'skills-icon-orange.svg'),
        newest: vscode.Uri.joinPath(context.extensionUri, 'resources', 'skills-icon-green.svg'),
        same:   vscode.Uri.joinPath(context.extensionUri, 'resources', 'skills-icon-blue.svg'),
    };
}

/**
 * Get folder icon URI
 */
function getFolderIcon(): vscode.Uri | vscode.ThemeIcon {
    return folderIconUri || new vscode.ThemeIcon('folder');
}

/**
 * Get skill icon URI based on duplicate status
 */
function getSkillIcon(status: SkillDuplicateStatus = 'unique'): vscode.Uri | vscode.ThemeIcon {
    return skillIconUris?.[status] || new vscode.ThemeIcon('extensions');
}

export class LocationTreeItem extends vscode.TreeItem {
    constructor(
        public readonly location: string,
        public readonly skills: InstalledSkill[],
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
    ) {
        super(location, collapsibleState);
        
        this.tooltip = `${skills.length} skill${skills.length !== 1 ? 's' : ''} installed`;
        this.iconPath = getFolderIcon();
        this.contextValue = 'location';
    }
}

export class InstalledSkillTreeItem extends vscode.TreeItem {
    constructor(
        public readonly installedSkill: InstalledSkill,
        public readonly skillUri: vscode.Uri,
        duplicateStatus: SkillDuplicateStatus = 'unique'
    ) {
        super(installedSkill.name, vscode.TreeItemCollapsibleState.Collapsed);
        
        this.description = installedSkill.description;
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${installedSkill.name}**\n\n`);
        this.tooltip.appendMarkdown(`${installedSkill.description}\n\n`);
        this.tooltip.appendMarkdown(`*Location: ${installedSkill.location}*`);
        
        this.iconPath = getSkillIcon(duplicateStatus);
        // Encode duplicate status into contextValue so menu visibility can key off it
        this.contextValue = duplicateStatus === 'newest' ? 'installedSkill_newest'
            : duplicateStatus === 'older' ? 'installedSkill_older'
            : 'installedSkill';
    }
}

export class SkillFolderTreeItem extends vscode.TreeItem {
    constructor(
        public readonly folderUri: vscode.Uri,
        public readonly folderName: string,
        public readonly parentItem: InstalledSkillTreeItem | SkillFolderTreeItem
    ) {
        super(folderName, vscode.TreeItemCollapsibleState.Collapsed);
        
        this.iconPath = getFolderIcon();
        this.contextValue = 'skillFolder';
    }
}

export class SkillFileTreeItem extends vscode.TreeItem {
    constructor(
        public readonly fileUri: vscode.Uri,
        public readonly fileName: string,
        public readonly parentFolder: SkillFolderTreeItem | InstalledSkillTreeItem
    ) {
        super(fileName, vscode.TreeItemCollapsibleState.None);
        
        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [fileUri]
        };
        
        this.iconPath = new vscode.ThemeIcon('file');
        this.contextValue = 'skillFile';
    }
}

/** File info collected for duplicate comparison */
interface FileInfo {
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

export class InstalledSkillsTreeDataProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private installedSkills: InstalledSkill[] = [];
    /** Computed duplicate status per skill location key */
    private duplicateStatusMap: Map<string, SkillDuplicateStatus> = new Map();
    private readonly pathService: SkillPathService;
    private collapsedLocations: Set<string>;
    private readonly COLLAPSED_STATE_KEY = 'agentSkills.collapsedLocations';
    private treeView?: vscode.TreeView<TreeNode>;
    private locationItems: Map<string, LocationTreeItem> = new Map();
    /** Active file watchers for duplicate status; disposed and recreated on refresh */
    private activeWatchers: vscode.Disposable[] = [];
    /** Current search filter query */
    private searchQuery: string = '';

    constructor(
        private readonly context: vscode.ExtensionContext,
        pathService?: SkillPathService
    ) {
        initializeIcons(context);
        this.pathService = pathService ?? new SkillPathService();
        
        // Load collapsed state
        this.collapsedLocations = new Set(
            this.context.workspaceState.get<string[]>(this.COLLAPSED_STATE_KEY, [])
        );

        // Scan installed skills on initialization
        this.scanInstalledSkills().then(async skills => {
            this.installedSkills = skills;
            await this.computeDuplicateStatuses();
            this._onDidChangeTreeData.fire();
        });
    }

    /**
     * Refresh the installed skills list and recreate file watchers
     */
    async refresh(): Promise<void> {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        this.pendingSkillNames.clear();
        this.installedSkills = await this.scanInstalledSkills();
        await this.computeDuplicateStatuses();
        this.recreateFileWatchers();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Set the tree view reference for expand/collapse operations
     */
    setTreeView(treeView: vscode.TreeView<TreeNode>): void {
        this.treeView = treeView;
    }

    /**
     * Expand all locations
     */
    async expandAll(): Promise<void> {
        this.collapsedLocations.clear();
        await this.saveCollapsedState();

        if (this.treeView) {
            for (const item of this.locationItems.values()) {
                try {
                    await this.treeView.reveal(item, { expand: true });
                } catch {
                    // ignore
                }
            }
        }

        this._onDidChangeTreeData.fire();
    }

    /**
     * Collapse all locations
     */
    async collapseAll(): Promise<void> {
        const groups = this.groupSkillsByLocation();
        for (const location of Object.keys(groups)) {
            this.collapsedLocations.add(location);
        }
        await this.saveCollapsedState();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Save collapsed state to workspace storage
     */
    private async saveCollapsedState(): Promise<void> {
        await this.context.workspaceState.update(
            this.COLLAPSED_STATE_KEY,
            Array.from(this.collapsedLocations)
        );
    }

    /**
     * Get names of all installed skills
     */
    getInstalledSkillNames(): Set<string> {
        return new Set(this.installedSkills.map(s => s.name));
    }

    /**
     * Get all installed skills
     */
    getInstalledSkills(): InstalledSkill[] {
        return this.installedSkills;
    }

    /**
     * Check if a skill is installed by name
     */
    isSkillInstalled(skillName: string): boolean {
        return this.installedSkills.some(s => s.name === skillName);
    }

    /**
     * Get the duplicate status for a skill by its location
     */
    getDuplicateStatus(location: string): SkillDuplicateStatus {
        return this.duplicateStatusMap.get(location) || 'unique';
    }

    /**
     * Find the newest copy of a skill by name (status === 'newest')
     */
    findNewestCopy(skillName: string): InstalledSkill | undefined {
        return this.installedSkills.find(
            s => s.name === skillName && this.duplicateStatusMap.get(s.location) === 'newest'
        );
    }

    /**
     * Set search query and filter results
     */
    setSearchQuery(query: string): void {
        this.searchQuery = query.toLowerCase();
        this._onDidChangeTreeData.fire();
        this.updateSearchContext();
    }

    /**
     * Clear search filter
     */
    clearSearch(): void {
        this.searchQuery = '';
        this._onDidChangeTreeData.fire();
        this.updateSearchContext();
    }

    /**
     * Update the context key for search active state
     */
    private updateSearchContext(): void {
        vscode.commands.executeCommand('setContext', 'agentSkills:installedSearchActive', this.searchQuery.length > 0);
    }

    /**
     * Get filtered skills based on current search query
     */
    private getFilteredSkills(): InstalledSkill[] {
        if (!this.searchQuery) {
            return this.installedSkills;
        }
        return this.installedSkills.filter(skill =>
            skill.name.toLowerCase().includes(this.searchQuery) ||
            skill.description.toLowerCase().includes(this.searchQuery)
        );
    }

    /**
     * Group skills by their base location
     */
    private groupSkillsByLocation(skills?: InstalledSkill[]): Record<string, InstalledSkill[]> {
        const groups: Record<string, InstalledSkill[]> = {};
        const source = skills ?? this.installedSkills;
        
        for (const skill of source) {
            // Normalize separators so both POSIX ('/') and Windows ('\') paths group consistently
            const normalizedLocation = skill.location.replace(/\\/g, '/');
            const lastSlash = normalizedLocation.lastIndexOf('/');
            const baseLocation = lastSlash > 0 ? normalizedLocation.substring(0, lastSlash) : normalizedLocation;
            
            if (!groups[baseLocation]) {
                groups[baseLocation] = [];
            }
            groups[baseLocation].push(skill);
        }
        
        return groups;
    }

    /**
     * Collect all file modification times for a skill directory recursively.
     * Returns files sorted with SKILL.md first, then alphabetically by relative path.
     */
    private async collectFileInfos(skillUri: vscode.Uri): Promise<FileInfo[]> {
        const fs = this.pathService.getFileSystem();
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

                        // Read content for text-based files
                        const ext = name.includes('.') ? name.substring(name.lastIndexOf('.')).toLowerCase() : '';
                        if (TEXT_EXTENSIONS.has(ext) || name.startsWith('.')) {
                            try {
                                const bytes = await fs.readFile(childUri);
                                info.content = new TextDecoder().decode(bytes);
                            } catch {
                                // couldn't read, fall back to mtime only
                            }
                        }

                        results.push(info);
                    }
                }
            } catch {
                // skip unreadable dirs
            }
        };

        await walk(skillUri, '');

        // Sort: SKILL.md first, then alphabetically
        results.sort((a, b) => {
            if (a.relativePath === 'SKILL.md') { return -1; }
            if (b.relativePath === 'SKILL.md') { return 1; }
            return a.relativePath.localeCompare(b.relativePath);
        });

        return results;
    }

    /**
     * Compare two skill copies by file content and modification dates.
     * Returns: 1 if skillA is newer, -1 if skillB is newer, 0 if same.
     *
     * Comparison order per shared file:
     *  1. If both have text content and it matches, the file is equivalent (skip date check)
     *  2. Otherwise compare by mtime
     *  3. If all shared files are equivalent, the copy with extra files is newer
     */
    private compareSkillFiles(filesA: FileInfo[], filesB: FileInfo[]): number {
        const mapA = new Map(filesA.map(f => [f.relativePath, f]));
        const mapB = new Map(filesB.map(f => [f.relativePath, f]));

        // Build union of paths in sorted order (SKILL.md first)
        const allPaths = new Set<string>();
        for (const f of filesA) { allPaths.add(f.relativePath); }
        for (const f of filesB) { allPaths.add(f.relativePath); }
        const sorted = [...allPaths].sort((a, b) => {
            if (a === 'SKILL.md') { return -1; }
            if (b === 'SKILL.md') { return 1; }
            return a.localeCompare(b);
        });

        // Track files unique to each side
        let extraA = 0;
        let extraB = 0;

        for (const p of sorted) {
            const fileA = mapA.get(p);
            const fileB = mapB.get(p);

            if (fileA && fileB) {
                // If both have text content and it's identical, skip this file
                if (fileA.content !== undefined && fileB.content !== undefined
                    && fileA.content === fileB.content) {
                    continue;
                }
                // Fall back to mtime comparison
                if (fileA.mtime > fileB.mtime) { return 1; }
                if (fileA.mtime < fileB.mtime) { return -1; }
            } else if (fileA && !fileB) {
                // File exists only in A — A has extra content
                extraA++;
            } else {
                // File exists only in B — B has extra content
                extraB++;
            }
        }

        // All shared files are equivalent — use extra-file counts as tie-break
        if (extraA > extraB) { return 1; }
        if (extraA < extraB) { return -1; }

        // Same shared content and same extra count but different file sets
        // means the copies aren't truly identical — use path-set comparison
        // as a deterministic tie-break so they aren't misclassified as "same"
        if (extraA > 0 || extraB > 0) {
            const pathsA = [...mapA.keys()].sort().join('\0');
            const pathsB = [...mapB.keys()].sort().join('\0');
            const cmp = pathsA.localeCompare(pathsB);
            if (cmp !== 0) { return cmp > 0 ? 1 : -1; }
        }

        return 0;
    }

    /**
     * Compute duplicate status for every installed skill.
     * Groups skills by name; for groups with >1 member, compares file dates.
     */
    private async computeDuplicateStatuses(): Promise<void> {
        this.duplicateStatusMap.clear();

        // Group by skill name
        const byName = new Map<string, InstalledSkill[]>();
        for (const skill of this.installedSkills) {
            const list = byName.get(skill.name) || [];
            list.push(skill);
            byName.set(skill.name, list);
        }

        for (const [, skills] of byName) {
            if (skills.length === 1) {
                // Only one copy — unique (purple)
                this.duplicateStatusMap.set(skills[0].location, 'unique');
                continue;
            }

            // Collect file infos for each copy
            const fileInfos: { skill: InstalledSkill; files: FileInfo[] }[] = [];
            for (const skill of skills) {
                const uri = this.resolveSkillUri(skill);
                if (uri) {
                    fileInfos.push({ skill, files: await this.collectFileInfos(uri) });
                }
            }

            if (fileInfos.length < 2) {
                // Couldn't resolve enough copies, mark all unique
                for (const skill of skills) {
                    this.duplicateStatusMap.set(skill.location, 'unique');
                }
                continue;
            }

            // Pairwise compare to find the newest copy
            // First check if all copies are the same
            let allSame = true;
            for (let i = 1; i < fileInfos.length; i++) {
                if (this.compareSkillFiles(fileInfos[0].files, fileInfos[i].files) !== 0) {
                    allSame = false;
                    break;
                }
            }

            if (allSame) {
                // All copies identical — blue
                for (const { skill } of fileInfos) {
                    this.duplicateStatusMap.set(skill.location, 'same');
                }
            } else {
                // Find the newest: compare each pair, track wins
                let newestIdx = 0;
                for (let i = 1; i < fileInfos.length; i++) {
                    if (this.compareSkillFiles(fileInfos[i].files, fileInfos[newestIdx].files) > 0) {
                        newestIdx = i;
                    }
                }

                for (let i = 0; i < fileInfos.length; i++) {
                    if (i === newestIdx) {
                        this.duplicateStatusMap.set(fileInfos[i].skill.location, 'newest');
                    } else {
                        this.duplicateStatusMap.set(fileInfos[i].skill.location, 'older');
                    }
                }
            }
        }
    }

    /**
     * Resolve a skill's location string to a URI
     */
    private resolveSkillUri(skill: InstalledSkill): vscode.Uri | undefined {
        const workspaceFolder = this.pathService.getWorkspaceFolder();
        const locationWorkspaceFolder = this.pathService.requiresWorkspaceFolder(skill.location)
            ? workspaceFolder
            : undefined;
        return this.pathService.resolveLocationToUri(skill.location, locationWorkspaceFolder);
    }

    /**
     * Recompute duplicate statuses for all skills sharing the given name,
     * then fire a tree refresh so icons update.
     */
    async refreshDuplicateStatusForSkillName(skillName: string): Promise<void> {
        const matching = this.installedSkills.filter(s => s.name === skillName);
        if (matching.length <= 1) {
            // Single or no copy — mark unique, refresh tree
            for (const skill of matching) {
                this.duplicateStatusMap.set(skill.location, 'unique');
            }
            this._onDidChangeTreeData.fire();
            return;
        }

        // Collect file infos for each copy
        const fileInfos: { skill: InstalledSkill; files: FileInfo[] }[] = [];
        for (const skill of matching) {
            const uri = this.resolveSkillUri(skill);
            if (uri) {
                fileInfos.push({ skill, files: await this.collectFileInfos(uri) });
            }
        }

        if (fileInfos.length < 2) {
            for (const skill of matching) {
                this.duplicateStatusMap.set(skill.location, 'unique');
            }
            this._onDidChangeTreeData.fire();
            return;
        }

        // Check if all copies are the same
        let allSame = true;
        for (let i = 1; i < fileInfos.length; i++) {
            if (this.compareSkillFiles(fileInfos[0].files, fileInfos[i].files) !== 0) {
                allSame = false;
                break;
            }
        }

        if (allSame) {
            for (const { skill } of fileInfos) {
                this.duplicateStatusMap.set(skill.location, 'same');
            }
        } else {
            let newestIdx = 0;
            for (let i = 1; i < fileInfos.length; i++) {
                if (this.compareSkillFiles(fileInfos[i].files, fileInfos[newestIdx].files) > 0) {
                    newestIdx = i;
                }
            }
            for (let i = 0; i < fileInfos.length; i++) {
                this.duplicateStatusMap.set(
                    fileInfos[i].skill.location,
                    i === newestIdx ? 'newest' : 'older'
                );
            }
        }

        this._onDidChangeTreeData.fire();
    }

    /**
     * Find the skill name that owns a given file URI, by matching against
     * resolved skill location URIs.
     */
    findSkillNameByFileUri(fileUri: vscode.Uri): string | undefined {
        const filePath = fileUri.fsPath.toLowerCase();
        const sep = path.sep;
        for (const skill of this.installedSkills) {
            const uri = this.resolveSkillUri(skill);
            if (!uri) { continue; }
            const skillPath = uri.fsPath.toLowerCase();
            // Ensure match is at a path-segment boundary to avoid
            // /skills/foo matching /skills/foo-bar
            if (filePath === skillPath ||
                filePath.startsWith(skillPath + sep)) {
                return skill.name;
            }
        }
        return undefined;
    }

    /**
     * Create file system watchers for all scan locations.
     * Watchers are tracked internally via activeWatchers and disposed
     * by recreateFileWatchers() on refresh or dispose() on deactivation.
     */
    createFileWatchers(): void {
        const watchers: vscode.Disposable[] = [];
        const locations = this.pathService.getScanLocations();

        for (const location of locations) {
            if (this.pathService.isHomeLocation(location)) {
                // Home directory locations: watch using absolute path URI
                const uri = this.pathService.resolveLocationToUri(location);
                if (uri) {
                    const pattern = new vscode.RelativePattern(uri, '**/*');
                    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
                    watcher.onDidChange(fileUri => this.onSkillFileChanged(fileUri));
                    watcher.onDidCreate(fileUri => this.onSkillFileChanged(fileUri));
                    watcher.onDidDelete(fileUri => this.onSkillFileChanged(fileUri));
                    watchers.push(watcher);
                }
            } else {
                // Workspace-relative locations: watch using glob pattern
                const watcher = vscode.workspace.createFileSystemWatcher(`**/${location}/**/*`);
                watcher.onDidChange(fileUri => this.onSkillFileChanged(fileUri));
                watcher.onDidCreate(fileUri => this.onSkillFileChanged(fileUri));
                watcher.onDidDelete(fileUri => this.onSkillFileChanged(fileUri));
                watchers.push(watcher);
            }
        }

        this.activeWatchers = watchers;
    }

    /**
     * Dispose existing file watchers and create new ones for current scan locations.
     * Called on refresh to pick up new or removed location directories.
     * Watchers are tracked internally via activeWatchers and not re-pushed
     * into context.subscriptions to avoid unbounded growth.
     */
    private recreateFileWatchers(): void {
        for (const watcher of this.activeWatchers) {
            watcher.dispose();
        }
        this.createFileWatchers();
    }

    /**
     * Dispose all active file watchers. Called on extension deactivation
     * via context.subscriptions.
     */
    dispose(): void {
        for (const watcher of this.activeWatchers) {
            watcher.dispose();
        }
        this.activeWatchers = [];
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        this.pendingSkillNames.clear();
    }

    /**
     * Handle a file change event within a skill location.
     * Debounces and refreshes duplicate status for the affected skill name.
     */
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private pendingSkillNames = new Set<string>();

    private onSkillFileChanged(fileUri: vscode.Uri): void {
        const skillName = this.findSkillNameByFileUri(fileUri);
        if (!skillName) {
            return;
        }

        this.pendingSkillNames.add(skillName);

        // Debounce: wait 500ms for rapid successive changes
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(async () => {
            const names = [...this.pendingSkillNames];
            this.pendingSkillNames.clear();
            for (const name of names) {
                await this.refreshDuplicateStatusForSkillName(name);
            }
        }, 500);
    }

    /**
     * Scan workspace for installed skills
     */
    async scanInstalledSkills(): Promise<InstalledSkill[]> {
        const workspaceFolder = this.pathService.getWorkspaceFolder();
        const fileSystem = this.pathService.getFileSystem();
        const locations = this.pathService.getScanLocations();
        const installed: InstalledSkill[] = [];

        for (const rawLocation of locations) {
            // Normalize separators so all downstream code (getParent,
            // groupSkillsByLocation, etc.) consistently sees forward slashes
            const location = normalizeSeparators(rawLocation);
            const locationWorkspaceFolder = this.pathService.requiresWorkspaceFolder(location)
                ? workspaceFolder
                : undefined;
            const dir = this.pathService.resolveLocationToUri(location, locationWorkspaceFolder);

            if (!dir) {
                continue;
            }

            if (!(await this.directoryExists(dir, fileSystem))) {
                continue;
            }
            
            try {
                const entries = await fileSystem.readDirectory(dir);
                
                for (const [name, type] of entries) {
                    if ((type & vscode.FileType.Directory) !== 0) {
                        const skillMdUri = vscode.Uri.joinPath(dir, name, 'SKILL.md');
                        
                        try {
                            const content = await fileSystem.readFile(skillMdUri);
                            const contentStr = new TextDecoder().decode(content);
                            const metadata = this.parseSkillMdMetadata(contentStr);
                            
                            installed.push({
                                name: metadata.name || name,
                                description: metadata.description || 'No description available',
                                location: `${location}/${name}`,
                                installedAt: new Date().toISOString()
                            });
                        } catch {
                            // SKILL.md doesn't exist, not a valid skill
                        }
                    }
                }
            } catch {
                // Directory doesn't exist
            }
        }

        return installed;
    }

    private async directoryExists(uri: vscode.Uri, fileSystem: vscode.FileSystem): Promise<boolean> {
        try {
            const stat = await fileSystem.stat(uri);
            return (stat.type & vscode.FileType.Directory) !== 0;
        } catch {
            return false;
        }
    }

    /**
     * Parse SKILL.md to extract basic metadata
     */
    private parseSkillMdMetadata(content: string): Partial<SkillMetadata> {
        const metadata: Partial<SkillMetadata> = {};
        
        const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!frontmatterMatch) {
            return metadata;
        }

        const yaml = frontmatterMatch[1];
        const nameMatch = yaml.match(/^name:\s*(.+)$/m);
        const descMatch = yaml.match(/^description:\s*(.+)$/m);
        
        if (nameMatch) {
            metadata.name = nameMatch[1].trim();
        }
        if (descMatch) {
            metadata.description = descMatch[1].trim();
        }

        return metadata;
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        if (element instanceof LocationTreeItem) {
            element.collapsibleState = this.collapsedLocations.has(element.location) 
                ? vscode.TreeItemCollapsibleState.Collapsed 
                : vscode.TreeItemCollapsibleState.Expanded;
        }
        return element;
    }

    getParent(element: TreeNode): vscode.ProviderResult<TreeNode> {
        if (element instanceof InstalledSkillTreeItem) {
            const loc = element.installedSkill.location;
            const lastSlash = loc.lastIndexOf('/');
            const baseLocation = lastSlash > 0 ? loc.substring(0, lastSlash) : loc;
            return this.locationItems.get(baseLocation);
        }
        
        if (element instanceof SkillFolderTreeItem) {
            return element.parentItem;
        }
        
        if (element instanceof SkillFileTreeItem) {
            return element.parentFolder;
        }
        
        return undefined;
    }

    /**
     * List files and folders in a skill directory
     */
    private async listSkillContents(skillUri: vscode.Uri, skillItem: InstalledSkillTreeItem): Promise<TreeNode[]> {
        const fileSystem = this.pathService.getFileSystem();
        const items: TreeNode[] = [];
        
        try {
            const entries = await fileSystem.readDirectory(skillUri);
            
            const folders: [string, vscode.FileType][] = [];
            const files: [string, vscode.FileType][] = [];
            
            for (const [name, type] of entries) {
                if ((type & vscode.FileType.Directory) !== 0) {
                    folders.push([name, type]);
                } else {
                    files.push([name, type]);
                }
            }
            
            folders.sort((a, b) => a[0].localeCompare(b[0]));
            files.sort((a, b) => a[0].localeCompare(b[0]));
            
            for (const [name] of folders) {
                const folderUri = vscode.Uri.joinPath(skillUri, name);
                const folderItem = new SkillFolderTreeItem(folderUri, name, skillItem);
                items.push(folderItem);
            }
            
            for (const [name] of files) {
                const fileUri = vscode.Uri.joinPath(skillUri, name);
                items.push(new SkillFileTreeItem(fileUri, name, skillItem));
            }
        } catch {
            // Error reading directory
        }
        
        return items;
    }

    /**
     * List files and folders in a nested directory
     */
    private async listFolderContents(folderUri: vscode.Uri, folderItem: SkillFolderTreeItem): Promise<TreeNode[]> {
        const fileSystem = this.pathService.getFileSystem();
        const items: TreeNode[] = [];
        
        try {
            const entries = await fileSystem.readDirectory(folderUri);
            
            const folders: [string, vscode.FileType][] = [];
            const files: [string, vscode.FileType][] = [];
            
            for (const [name, type] of entries) {
                if ((type & vscode.FileType.Directory) !== 0) {
                    folders.push([name, type]);
                } else {
                    files.push([name, type]);
                }
            }
            
            folders.sort((a, b) => a[0].localeCompare(b[0]));
            files.sort((a, b) => a[0].localeCompare(b[0]));
            
            for (const [name] of folders) {
                const childFolderUri = vscode.Uri.joinPath(folderUri, name);
                const childFolderItem = new SkillFolderTreeItem(childFolderUri, name, folderItem);
                items.push(childFolderItem);
            }
            
            for (const [name] of files) {
                const fileUri = vscode.Uri.joinPath(folderUri, name);
                items.push(new SkillFileTreeItem(fileUri, name, folderItem));
            }
        } catch {
            // Error reading directory
        }
        
        return items;
    }

    getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]> {
        if (element instanceof SkillFileTreeItem) {
            return [];
        }
        
        if (element instanceof SkillFolderTreeItem) {
            return this.listFolderContents(element.folderUri, element);
        }
        
        if (element instanceof InstalledSkillTreeItem) {
            return this.listSkillContents(element.skillUri, element);
        }
        
        if (element instanceof LocationTreeItem) {
            const result: InstalledSkillTreeItem[] = [];
            for (const skill of element.skills) {
                const workspaceFolder = this.pathService.getWorkspaceFolder();
                const locationWorkspaceFolder = this.pathService.requiresWorkspaceFolder(element.location)
                    ? workspaceFolder
                    : undefined;
                const dir = this.pathService.resolveLocationToUri(element.location, locationWorkspaceFolder);
                
                if (!dir) {
                    continue;
                }
                
                const skillName = skill.location.substring(skill.location.lastIndexOf('/') + 1);
                const skillUri = vscode.Uri.joinPath(dir, skillName);
                const status = this.duplicateStatusMap.get(skill.location) || 'unique';
                const item = new InstalledSkillTreeItem(skill, skillUri, status);
                result.push(item);
            }
            return result;
        }
        
        // Root level
        if (this.installedSkills.length === 0) {
            return [];
        }

        const filtered = this.getFilteredSkills();

        // Show "no results" placeholder when search is active but nothing matches
        if (filtered.length === 0 && this.searchQuery) {
            const noResults = new vscode.TreeItem(
                `No results for "${this.searchQuery}"`,
                vscode.TreeItemCollapsibleState.None
            );
            noResults.iconPath = new vscode.ThemeIcon('search-stop');
            return [noResults as unknown as TreeNode];
        }
        
        const groups = this.groupSkillsByLocation(filtered);
        const nextLocationItems = new Map<string, LocationTreeItem>();
        const items = Object.entries(groups).map(([location, skills]) => {
            const collapsibleState = this.collapsedLocations.has(location) 
                ? vscode.TreeItemCollapsibleState.Collapsed 
                : vscode.TreeItemCollapsibleState.Expanded;
            const item = new LocationTreeItem(location, skills, collapsibleState);
            nextLocationItems.set(location, item);
            return item;
        });

        this.locationItems = nextLocationItems;
        return items;
    }

    onDidCollapseElement(element: TreeNode): void {
        if (element instanceof LocationTreeItem) {
            this.collapsedLocations.add(element.location);
            this.saveCollapsedState();
        }
    }

    onDidExpandElement(element: TreeNode): void {
        if (element instanceof LocationTreeItem) {
            this.collapsedLocations.delete(element.location);
            this.saveCollapsedState();
        }
    }
}
