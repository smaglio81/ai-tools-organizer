/**
 * Marketplace TreeDataProvider - displays available skills from configured repositories
 */

import * as vscode from 'vscode';
import { Skill, FailedRepository, SkillRepository, isSameRepository, readRepositoriesConfig, ContentArea, AREA_DEFINITIONS, AreaFileItem } from '../types';
import { GitHubSkillsClient } from '../github/skillsClient';

let extensionUri: vscode.Uri | undefined;

/** Area icon URIs keyed by `${area}-${color}` */
const areaIconCache = new Map<string, vscode.Uri>();

/**
 * Initialize marketplace icons from extension resources
 */
export function initializeMarketplaceIcons(context: vscode.ExtensionContext): void {
    if (!context.extensionUri) {
        return;
    }
    extensionUri = context.extensionUri;
}

/**
 * Get the SVG icon for an area.
 * - 'default' returns the area-colored group icon ({area}-icon.svg)
 * - status colors ('purple','green','orange','blue') return the status-colored item icon ({area}-icon-{color}.svg)
 */
function getAreaIcon(area: ContentArea, color: 'purple' | 'green' | 'orange' | 'blue' | 'default' = 'default'): vscode.Uri | vscode.ThemeIcon {
    if (!extensionUri) {
        return new vscode.ThemeIcon(AREA_DEFINITIONS[area].groupIcon);
    }
    const iconName = AREA_DEFINITIONS[area].iconPrefix || area;
    const suffix = color === 'default' ? '' : `-${color}`;
    const key = `${iconName}${suffix}`;
    let uri = areaIconCache.get(key);
    if (!uri) {
        uri = vscode.Uri.joinPath(extensionUri, 'resources', `${iconName}-icon${suffix}.svg`);
        areaIconCache.set(key, uri);
    }
    return uri;
}

/**
 * Get item icon in a status color.
 * 'default' = area's own color (unique), plus green/orange/blue for duplicate statuses.
 */
function getItemIcon(area: ContentArea = 'skills', status: 'default' | 'green' | 'orange' | 'blue' = 'default'): vscode.Uri | vscode.ThemeIcon {
    return getAreaIcon(area, status);
}

export class SkillTreeItem extends vscode.TreeItem {
    constructor(
        public readonly skill: Skill,
        public readonly isInstalled: boolean = false
    ) {
        super(skill.name, vscode.TreeItemCollapsibleState.None);
        
        this.description = this.truncateDescription(skill.description, 60);
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${skill.name}**\n\n`);
        this.tooltip.appendMarkdown(`${skill.description}\n\n`);
        if (skill.license) {
            this.tooltip.appendMarkdown(`*License: ${skill.license}*\n\n`);
        }
        this.tooltip.appendMarkdown(`Source: \`${skill.source.owner}/${skill.source.repo}\``);
        
        this.iconPath = isInstalled
            ? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
            : getItemIcon(skill.area || 'skills', 'default');
        this.contextValue = 'skill';
        
        // Click to view details
        this.command = {
            command: 'agentOrganizer.viewDetails',
            title: 'View Details',
            arguments: [skill]
        };
    }

    private truncateDescription(text: string, maxLength: number): string {
        if (text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength - 3) + '...';
    }
}

export class SourceTreeItem extends vscode.TreeItem {
    constructor(
        public readonly sourceName: string,
        public readonly skills: Skill[],
        public readonly fileItems: AreaFileItem[],
        public readonly repo: SkillRepository
    ) {
        super(sourceName, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('github');
        const totalItems = skills.length + fileItems.length;
        this.description = `${totalItems} item${totalItems !== 1 ? 's' : ''}`;
        this.contextValue = 'source';
    }
}

/**
 * Build a concise label for a SkillRepository, including path/branch
 * when they help distinguish multiple configs of the same repo.
 */
function repoLabel(repo: SkillRepository): string {
    const base = `${repo.owner}/${repo.repo}`;
    const branchSuffix = repo.branch && repo.branch !== 'main' ? `@${repo.branch}` : '';
    return `${base}${branchSuffix}`;
}

export class FailedSourceTreeItem extends vscode.TreeItem {
    constructor(public readonly failure: FailedRepository) {
        super(repoLabel(failure.repo), vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
        this.description = 'Failed to load';
        this.tooltip = new vscode.MarkdownString(`**$(warning) Failed to load**\n\n${failure.error}`);
        this.tooltip.supportThemeIcons = true;
        this.contextValue = 'failedSource';
    }
}

export class LoadingSourceTreeItem extends vscode.TreeItem {
    constructor(public readonly repo: SkillRepository) {
        super(repoLabel(repo), vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('loading~spin');
        this.description = 'Loading...';
        this.contextValue = 'sourceLoading';
    }
}

export class SkillsGroupTreeItem extends vscode.TreeItem {
    public readonly areaPath: string;
    constructor(
        public readonly skills: Skill[],
        public readonly parentSource: SourceTreeItem,
        public readonly area: ContentArea
    ) {
        const def = AREA_DEFINITIONS[area];
        super(def.label, vscode.TreeItemCollapsibleState.Collapsed);
        this.description = `${skills.length}`;
        this.iconPath = getAreaIcon(area, 'default');
        this.contextValue = 'skillsGroup';
        // Derive area path from first skill's skillPath (e.g. "skills/foo" → "skills")
        const first = skills[0]?.skillPath || '';
        this.areaPath = first.includes('/') ? first.substring(0, first.indexOf('/')) : first;
    }
}

export class AreaGroupTreeItem extends vscode.TreeItem {
    public readonly areaPath: string;
    constructor(
        public readonly fileItems: AreaFileItem[],
        public readonly parentSource: SourceTreeItem,
        public readonly area: ContentArea
    ) {
        const def = AREA_DEFINITIONS[area];
        super(def.label, vscode.TreeItemCollapsibleState.Collapsed);
        this.description = `${fileItems.length}`;
        this.iconPath = getAreaIcon(area, 'default');
        this.contextValue = 'areaGroup';
        // Derive area path from first file item's filePath (e.g. "agents/foo.agent.md" → "agents")
        const first = fileItems[0]?.filePath || '';
        this.areaPath = first.includes('/') ? first.substring(0, first.indexOf('/')) : first;
    }
}

export class AreaFolderTreeItem extends vscode.TreeItem {
    constructor(
        public readonly folderPath: string,
        public readonly items: AreaFileItem[],
        public readonly parentGroup: AreaGroupTreeItem
    ) {
        super(folderPath, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'areaFolder';
    }
}

export class AreaFileTreeItem extends vscode.TreeItem {
    constructor(
        public readonly fileItem: AreaFileItem,
        public readonly isInstalled: boolean = false
    ) {
        super(fileItem.name, vscode.TreeItemCollapsibleState.None);
        this.description = fileItem.description || '';
        this.tooltip = `${fileItem.name}\nSource: ${fileItem.source.owner}/${fileItem.source.repo}`;
        this.iconPath = isInstalled
            ? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
            : getItemIcon(fileItem.area, 'default');
        this.contextValue = 'areaFile';

        // Click to view details
        this.command = {
            command: 'agentOrganizer.viewFileDetails',
            title: 'View Details',
            arguments: [fileItem]
        };
    }
}

type MarketplaceNode = SkillTreeItem | SourceTreeItem | FailedSourceTreeItem | LoadingSourceTreeItem | SkillsGroupTreeItem | AreaGroupTreeItem | AreaFolderTreeItem | AreaFileTreeItem;

export class MarketplaceTreeDataProvider implements vscode.TreeDataProvider<MarketplaceNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<MarketplaceNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private skills: Skill[] = [];
    private fileItems: AreaFileItem[] = [];
    private failures: FailedRepository[] = [];
    private searchQuery: string = '';
    private installedSkillNames: Set<string> = new Set();
    /** Names of all installed items across all areas (skills + area items) */
    private installedItemNames: Set<string> = new Set();
    private isLoading: boolean = false;
    private loadingRepos: SkillRepository[] = [];
    private loadGeneration: number = 0;
    private groupBySource: boolean = true;
    private _suppressNextConfigRefresh: boolean = false;
    /** Cached tree items for getParent / reveal support */
    private cachedSourceItems: SourceTreeItem[] = [];
    private cachedSkillItems: Map<string, { item: SkillTreeItem; parent: SkillsGroupTreeItem }> = new Map();
    private treeView?: vscode.TreeView<MarketplaceNode>;

    constructor(
        private readonly githubClient: GitHubSkillsClient,
        private readonly context: vscode.ExtensionContext
    ) {
        initializeMarketplaceIcons(context);
    }

    /**
     * Build a stable unique cache key for a skill, including the full
     * repository identity so different branch/path configs don't collide.
     */
    private skillCacheKey(skill: Skill): string {
        const s = skill.source;
        return `${s.owner}/${s.repo}@${s.branch || 'main'}/${skill.skillPath}`;
    }

    /**
     * Suppress the next config-change-triggered full refresh (used when the
     * extension itself made the config change and handles the update incrementally).
     */
    suppressConfigRefresh(): void {
        this._suppressNextConfigRefresh = true;
    }

    /**
     * Returns true if a config-change refresh should proceed, false if it was
     * suppressed (clears the flag on the way out).
     */
    shouldHandleConfigChange(): boolean {
        if (this._suppressNextConfigRefresh) {
            this._suppressNextConfigRefresh = false;
            return false;
        }
        return true;
    }

    /**
     * Incrementally add a single repository — fetches only that repo's skills.
     */
    async addRepoToMarketplace(repo: SkillRepository): Promise<void> {
        this.loadingRepos.push(repo);
        this._onDidChangeTreeData.fire();

        try {
            const discovered = await this.githubClient.discoverAreas(repo.owner, repo.repo, repo.branch || 'main');

            if (Object.keys(discovered).length > 0) {
                const content = await this.githubClient.fetchRepoContent(repo, discovered);
                this.skills.push(...content.skills);
                this.fileItems.push(...content.fileItems);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.failures.push({ repo, error: message });
        } finally {
            this.loadingRepos = this.loadingRepos.filter(r => !isSameRepository(r, repo));
        }

        this._onDidChangeTreeData.fire();
    }

    /**
     * Incrementally remove a single repository — no network requests needed.
     */
    removeRepoFromMarketplace(repo: SkillRepository): void {
        this.skills = this.skills.filter(s => !isSameRepository(s.source, repo));
        this.fileItems = this.fileItems.filter(f => !isSameRepository(f.source, repo));
        this.failures = this.failures.filter(
            f => !isSameRepository(f.repo, repo)
        );
        this.loadingRepos = this.loadingRepos.filter(r => !isSameRepository(r, repo));
        this._onDidChangeTreeData.fire();
    }

    /**
     * Refresh the marketplace data
     */
    async refresh(): Promise<void> {
        await this.loadRepositoriesProgressively(true);
    }

    /**
     * Initial load of skills
     */
    async loadSkills(): Promise<void> {
        if (this.skills.length === 0 && !this.isLoading) {
            await this.loadRepositoriesProgressively(false);
        }
    }

    private async loadRepositoriesProgressively(clearCache: boolean): Promise<void> {
        const repositories = readRepositoriesConfig();

        const generation = ++this.loadGeneration;

        if (clearCache) {
            this.githubClient.clearCache();
        }

        this.skills = [];
        this.fileItems = [];
        this.failures = [];
        // Clear stale tree-item caches so getParent/reveal don't reference old items
        this.cachedSourceItems = [];
        this.cachedSkillItems.clear();
        this.loadingRepos = [...repositories];
        this.isLoading = repositories.length > 0;
        this._onDidChangeTreeData.fire();

        if (repositories.length === 0) {
            this.isLoading = false;
            this._onDidChangeTreeData.fire();
            return;
        }

        // Process repos with limited concurrency so the event loop has breathing
        // room for local filesystem operations (installed skill scans, etc.).
        const concurrency = 2;
        const queue = [...repositories];
        const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
            while (queue.length > 0) {
                if (generation !== this.loadGeneration) { return; }
                const repo = queue.shift()!;
                try {
                    const discovered = await this.githubClient.discoverAreas(repo.owner, repo.repo, repo.branch || 'main');
                    if (generation !== this.loadGeneration) { return; }

                    if (Object.keys(discovered).length > 0) {
                        const content = await this.githubClient.fetchRepoContent(repo, discovered);
                        if (generation !== this.loadGeneration) { return; }
                        this.skills.push(...content.skills);
                        this.fileItems.push(...content.fileItems);
                    }
                } catch (error) {
                    if (generation !== this.loadGeneration) { return; }
                    const message = error instanceof Error ? error.message : String(error);
                    this.failures.push({ repo, error: message });
                } finally {
                    if (generation !== this.loadGeneration) { return; }
                    this.loadingRepos = this.loadingRepos.filter(r => !isSameRepository(r, repo));
                    this.isLoading = this.loadingRepos.length > 0;
                    this._onDidChangeTreeData.fire();
                }
            }
        });
        await Promise.allSettled(workers);
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
     * Check if search is active
     */
    isSearchActive(): boolean {
        return this.searchQuery.length > 0;
    }

    /**
     * Update VS Code context key for search state
     */
    private updateSearchContext(): void {
        vscode.commands.executeCommand('setContext', 'agentOrganizer:searchActive', this.isSearchActive());
    }

    /**
     * Update the set of installed skill names
     */
    setInstalledSkills(names: Set<string>): void {
        this.installedSkillNames = names;
        this._onDidChangeTreeData.fire();
    }

    /**
     * Update the set of all installed item names (skills + area items).
     * Used to show green check icons on marketplace items that exist locally.
     */
    setInstalledItemNames(names: Set<string>): void {
        this.installedItemNames = names;
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get all loaded skills
     */
    getSkills(): Skill[] {
        return this.skills;
    }

    /**
     * Get a skill by name
     */
    getSkillByName(name: string): Skill | undefined {
        return this.skills.find(s => s.name === name);
    }

    /**
     * Store the tree view reference for reveal operations
     */
    setTreeView(treeView: vscode.TreeView<MarketplaceNode>): void {
        this.treeView = treeView;
    }

    /**
     * getParent implementation required for TreeView.reveal() to work.
     * Returns the parent node for any child item, or undefined for root items.
     */
    getParent(element: MarketplaceNode): vscode.ProviderResult<MarketplaceNode> {
        if (element instanceof SkillTreeItem) {
            const cached = this.cachedSkillItems.get(this.skillCacheKey(element.skill));
            if (cached) {
                return cached.parent;
            }
        }
        if (element instanceof SkillsGroupTreeItem) {
            return element.parentSource;
        }
        if (element instanceof AreaGroupTreeItem) {
            return element.parentSource;
        }
        if (element instanceof AreaFolderTreeItem) {
            return element.parentGroup;
        }
        if (element instanceof AreaFileTreeItem) {
            // For now, no cached parent for file items
        }
        return undefined;
    }

    /**
     * Reveal a skill by name in the marketplace tree view.
     * Clears any active search, finds the parent source group,
     * expands it, then selects and focuses the matching skill item.
     */
    async revealSkillByName(skillName: string): Promise<boolean> {
        if (!this.treeView) {
            return false;
        }

        const skill = this.skills.find(s => s.name === skillName);
        if (!skill) {
            vscode.window.showInformationMessage(`"${skillName}" was not found in the Marketplace.`);
            return false;
        }

        // Clear search so the full tree is visible
        if (this.searchQuery) {
            this.clearSearch();
        }

        // Rebuild root-level items synchronously to populate cachedSourceItems
        await Promise.resolve(this.getChildren());

        // Locate the parent source group for the target skill
        const sourceItem = this.cachedSourceItems.find(s => isSameRepository(s.repo, skill.source));
        if (sourceItem) {
            // Force child creation to populate the SkillsGroupTreeItem
            const sourceChildren = await Promise.resolve(this.getChildren(sourceItem));

            try {
                await this.treeView.reveal(sourceItem, { select: false, focus: false, expand: true });
            } catch {
                // ignore
            }

            // Expand the SkillsGroupTreeItem for the target skill's area to populate cachedSkillItems
            const skillsGroup = sourceChildren?.find(
                (c): c is SkillsGroupTreeItem => c instanceof SkillsGroupTreeItem && c.area === skill.area
            );
            if (skillsGroup) {
                await Promise.resolve(this.getChildren(skillsGroup));
                try {
                    await this.treeView.reveal(skillsGroup, { select: false, focus: false, expand: true });
                } catch {
                    // ignore
                }
            }
        }

        // Reveal the cached skill item
        const cached = this.cachedSkillItems.get(this.skillCacheKey(skill));
        if (cached) {
            try {
                await this.treeView.reveal(cached.item, { select: true, focus: true });
                return true;
            } catch {
                // reveal can fail if the tree hasn't fully rendered
            }
        }

        return false;
    }

    /**
     * Reveal an item in the Marketplace tree by name, searching both skills and area file items.
     */
    async revealItemByName(itemName: string): Promise<boolean> {
        // Try multi-file items (skills, hooks-github, plugins) first
        const skill = this.skills.find(s => s.name === itemName);
        if (skill) {
            return this.revealSkillByName(itemName);
        }

        // Try single-file area items (agents, instructions, prompts)
        if (!this.treeView) { return false; }

        const fileItem = this.fileItems.find(f => f.name === itemName);
        if (!fileItem) {
            vscode.window.showInformationMessage(`"${itemName}" was not found in the Marketplace.`);
            return false;
        }

        if (this.searchQuery) { this.clearSearch(); }

        // Rebuild root to populate cachedSourceItems
        await Promise.resolve(this.getChildren());

        const sourceItem = this.cachedSourceItems.find(s => isSameRepository(s.repo, fileItem.source));
        if (sourceItem) {
            const sourceChildren = await Promise.resolve(this.getChildren(sourceItem));
            try {
                await this.treeView.reveal(sourceItem, { select: false, focus: false, expand: true });
            } catch { /* ignore */ }

            // Find the AreaGroupTreeItem for this file's area
            const areaGroup = sourceChildren?.find(
                (c): c is AreaGroupTreeItem => c instanceof AreaGroupTreeItem && c.area === fileItem.area
            );
            if (areaGroup) {
                const areaChildren = await Promise.resolve(this.getChildren(areaGroup));
                try {
                    await this.treeView.reveal(areaGroup, { select: false, focus: false, expand: true });
                } catch { /* ignore */ }

                // Find the AreaFileTreeItem matching the name
                const fileTreeItem = areaChildren?.find(
                    (c): c is AreaFileTreeItem => c instanceof AreaFileTreeItem && c.fileItem.name === itemName
                );
                if (fileTreeItem) {
                    try {
                        await this.treeView.reveal(fileTreeItem, { select: true, focus: true });
                        return true;
                    } catch { /* ignore */ }
                }
            }
        }

        return false;
    }

    getTreeItem(element: MarketplaceNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: MarketplaceNode): vscode.ProviderResult<MarketplaceNode[]> {

        if (!element) {
            // Root level — clear stale tree-item caches before rebuilding
            this.cachedSourceItems = [];
            this.cachedSkillItems.clear();

            const filteredSkills = this.getFilteredSkills();
            const filteredFileItems = this.getFilteredFileItems();
            
            if (filteredSkills.length === 0 && filteredFileItems.length === 0 && this.skills.length === 0 && this.fileItems.length === 0 && this.failures.length === 0 && this.loadingRepos.length === 0) {
                return [this.createEmptyItem()];
            }

            if (filteredSkills.length === 0 && filteredFileItems.length === 0 && this.searchQuery) {
                return [this.createNoResultsItem()];
            }

            const failureItems = this.searchQuery
                ? [] // hide failed entries when a search is active
                : [...this.failures]
                    .sort((a, b) => `${a.repo.owner}/${a.repo.repo}`.localeCompare(`${b.repo.owner}/${b.repo.repo}`))
                    .map(f => new FailedSourceTreeItem(f));

            const loadingItems = this.searchQuery
                ? [] // hide loading entries when a search is active
                : [...this.loadingRepos]
                    .sort((a, b) => `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`))
                    .map(r => new LoadingSourceTreeItem(r));

            if (this.groupBySource) {
                const sourceGroups = this.getSourceGroups(filteredSkills);
                this.cachedSourceItems = sourceGroups;
                return [...sourceGroups, ...failureItems, ...loadingItems];
            } else {
                return [
                    ...filteredSkills.map(skill => new SkillTreeItem(skill, this.installedSkillNames.has(skill.name) || this.installedItemNames.has(skill.name))),
                    ...failureItems,
                    ...loadingItems
                ];
            }
        }

        if (element instanceof SourceTreeItem) {
            const groups: MarketplaceNode[] = [];

            // Group multi-file items (skills, plugins, powers) by area
            const multiFileByArea = new Map<ContentArea, Skill[]>();
            for (const skill of element.skills) {
                const area = skill.area || 'skills';
                if (!multiFileByArea.has(area)) { multiFileByArea.set(area, []); }
                multiFileByArea.get(area)!.push(skill);
            }
            for (const [area, skills] of multiFileByArea) {
                groups.push(new SkillsGroupTreeItem(skills, element, area));
            }

            // Group single-file items by area
            const singleFileByArea = new Map<ContentArea, AreaFileItem[]>();
            for (const item of element.fileItems) {
                if (!singleFileByArea.has(item.area)) { singleFileByArea.set(item.area, []); }
                singleFileByArea.get(item.area)!.push(item);
            }
            for (const [area, items] of singleFileByArea) {
                groups.push(new AreaGroupTreeItem(items, element, area));
            }

            // Sort groups alphabetically by label
            groups.sort((a, b) => (a.label as string).localeCompare(b.label as string));
            return groups;
        }

        if (element instanceof SkillsGroupTreeItem) {
            const items = [...element.skills]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(skill => new SkillTreeItem(skill, this.installedSkillNames.has(skill.name) || this.installedItemNames.has(skill.name)));
            for (const item of items) {
                this.cachedSkillItems.set(this.skillCacheKey(item.skill), { item, parent: element });
            }
            return items;
        }

        if (element instanceof AreaGroupTreeItem) {
            // Group items by folder, then show folders and root-level files
            const rootItems: AreaFileItem[] = [];
            const folders = new Map<string, AreaFileItem[]>();
            for (const item of element.fileItems) {
                if (item.folderPath) {
                    const topFolder = item.folderPath.split('/')[0];
                    if (!folders.has(topFolder)) { folders.set(topFolder, []); }
                    folders.get(topFolder)!.push(item);
                } else {
                    rootItems.push(item);
                }
            }

            const children: MarketplaceNode[] = [];
            // Folders first, sorted
            for (const [folderPath, items] of [...folders.entries()].sort(([a], [b]) => a.localeCompare(b))) {
                children.push(new AreaFolderTreeItem(folderPath, items, element));
            }
            // Then root-level files, sorted
            for (const item of rootItems.sort((a, b) => a.name.localeCompare(b.name))) {
                children.push(new AreaFileTreeItem(item, this.installedItemNames.has(item.name)));
            }
            return children;
        }

        if (element instanceof AreaFolderTreeItem) {
            return element.items
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(item => new AreaFileTreeItem(item, this.installedItemNames.has(item.name)));
        }

        return [];
    }

    private getFilteredFileItems(): AreaFileItem[] {
        if (!this.searchQuery) {
            return this.fileItems;
        }
        return this.fileItems.filter(item =>
            item.name.toLowerCase().includes(this.searchQuery) ||
            (item.description || '').toLowerCase().includes(this.searchQuery)
        );
    }

    private getFilteredSkills(): Skill[] {
        if (!this.searchQuery) {
            return this.skills;
        }
        
        return this.skills.filter(skill => 
            skill.name.toLowerCase().includes(this.searchQuery) ||
            skill.description.toLowerCase().includes(this.searchQuery)
        );
    }

    private getSourceGroups(skills: Skill[]): SourceTreeItem[] {
        const groups = new Map<string, { skills: Skill[]; fileItems: AreaFileItem[]; repo: SkillRepository }>();
        
        for (const skill of skills) {
            const key = this.repoGroupKey(skill.source);
            if (!groups.has(key)) {
                groups.set(key, { skills: [], fileItems: [], repo: skill.source });
            }
            groups.get(key)!.skills.push(skill);
        }

        // Add file items to their source groups
        const filteredFileItems = this.getFilteredFileItems();
        for (const item of filteredFileItems) {
            const key = this.repoGroupKey(item.source);
            if (!groups.has(key)) {
                groups.set(key, { skills: [], fileItems: [], repo: item.source });
            }
            groups.get(key)!.fileItems.push(item);
        }
        
        return Array.from(groups.entries())
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([_key, { skills: skillList, fileItems, repo }]) => {
                const label = this.buildSourceLabel(repo, groups);
                return new SourceTreeItem(label, skillList, fileItems, repo);
            });
    }

    /**
     * Build a stable grouping key for a SkillRepository that includes
     * owner, repo, path, and branch so distinct configs stay separate.
     */
    private repoGroupKey(repo: SkillRepository): string {
        return `${repo.owner}/${repo.repo}@${repo.branch || 'main'}`;
    }

    /**
     * Build a disambiguated label for a source group.
     * Uses just owner/repo when unique; appends path and/or branch
     * only when needed to distinguish from other configs of the same repo.
     */
    private buildSourceLabel(
        repo: SkillRepository,
        groups: Map<string, { skills: Skill[]; fileItems: AreaFileItem[]; repo: SkillRepository }>
    ): string {
        const base = `${repo.owner}/${repo.repo}`;

        // Collect all configs sharing the same owner/repo
        const siblings: SkillRepository[] = [];
        for (const [, { repo: r }] of groups) {
            if (`${r.owner}/${r.repo}` === base) {
                siblings.push(r);
            }
        }

        // Only one config — plain label
        if (siblings.length <= 1) {
            return base;
        }

        // Multiple configs for same repo — disambiguate with branch
        return `${base} @ ${repo.branch || 'main'}`;
    }

    private createEmptyItem(): SkillTreeItem {
        const item = new vscode.TreeItem('No skills available', vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('info');
        item.description = 'Click refresh to load skills';
        return item as unknown as SkillTreeItem;
    }

    private createNoResultsItem(): SkillTreeItem {
        const item = new vscode.TreeItem(`No results for "${this.searchQuery}"`, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('search-stop');
        return item as unknown as SkillTreeItem;
    }
}
