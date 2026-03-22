/**
 * Marketplace TreeDataProvider - displays available skills from configured repositories
 */

import * as vscode from 'vscode';
import { Skill, FailedRepository, SkillRepository } from '../types';
import { GitHubSkillsClient } from '../github/skillsClient';

let skillIconUri: vscode.Uri;

/**
 * Initialize skill icon from extension resources
 */
export function initializeMarketplaceIcons(context: vscode.ExtensionContext): void {
    skillIconUri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'skills-icon-purple.svg');
}

/**
 * Get skill icon URI
 */
function getSkillIcon(): vscode.Uri | vscode.ThemeIcon {
    return skillIconUri || new vscode.ThemeIcon('extensions');
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
            : getSkillIcon();
        this.contextValue = 'skill';
        
        // Click to view details
        this.command = {
            command: 'agentSkills.viewDetails',
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
        public readonly repo: SkillRepository
    ) {
        super(sourceName, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('github');
        this.description = `${skills.length} skill${skills.length !== 1 ? 's' : ''}`;
        this.contextValue = 'source';
    }
}

export class FailedSourceTreeItem extends vscode.TreeItem {
    constructor(public readonly failure: FailedRepository) {
        super(`${failure.repo.owner}/${failure.repo.repo}`, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
        this.description = 'Failed to load';
        this.tooltip = new vscode.MarkdownString(`**$(warning) Failed to load**\n\n${failure.error}`);
        this.tooltip.supportThemeIcons = true;
        this.contextValue = 'failedSource';
    }
}

export class LoadingSourceTreeItem extends vscode.TreeItem {
    constructor(public readonly repo: SkillRepository) {
        super(`${repo.owner}/${repo.repo}`, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('loading~spin');
        this.description = 'Loading...';
        this.contextValue = 'sourceLoading';
    }
}

export class MarketplaceTreeDataProvider implements vscode.TreeDataProvider<SkillTreeItem | SourceTreeItem | FailedSourceTreeItem | LoadingSourceTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SkillTreeItem | SourceTreeItem | FailedSourceTreeItem | LoadingSourceTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private skills: Skill[] = [];
    private failures: FailedRepository[] = [];
    private searchQuery: string = '';
    private installedSkillNames: Set<string> = new Set();
    private isLoading: boolean = false;
    private loadingRepos: SkillRepository[] = [];
    private loadGeneration: number = 0;
    private groupBySource: boolean = true;
    private _suppressNextConfigRefresh: boolean = false;
    /** Cached tree items for getParent / reveal support */
    private cachedSourceItems: SourceTreeItem[] = [];
    private cachedSkillItems: Map<string, { item: SkillTreeItem; parent: SourceTreeItem }> = new Map();
    private treeView?: vscode.TreeView<SkillTreeItem | SourceTreeItem | FailedSourceTreeItem | LoadingSourceTreeItem>;

    constructor(
        private readonly githubClient: GitHubSkillsClient,
        private readonly context: vscode.ExtensionContext
    ) {
        initializeMarketplaceIcons(context);
    }

    /**
     * Build a stable unique cache key for a skill (owner/repo/skillPath).
     */
    private skillCacheKey(skill: Skill): string {
        return `${skill.source.owner}/${skill.source.repo}/${skill.skillPath}`;
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
            const skills = await this.githubClient.fetchSkillsFromRepo(repo);
            this.skills.push(...skills);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.failures.push({ repo, error: message });
        } finally {
            this.loadingRepos = this.loadingRepos.filter(r => !this.isSameRepository(r, repo));
        }

        this._onDidChangeTreeData.fire();
    }

    /**
     * Incrementally remove a single repository — no network requests needed.
     */
    removeRepoFromMarketplace(repo: SkillRepository): void {
        this.skills = this.skills.filter(
            s => !(s.source.owner === repo.owner && s.source.repo === repo.repo && s.source.path === repo.path)
        );
        this.failures = this.failures.filter(
            f => !(f.repo.owner === repo.owner && f.repo.repo === repo.repo && f.repo.path === repo.path)
        );
        this.loadingRepos = this.loadingRepos.filter(r => !this.isSameRepository(r, repo));
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
        const config = vscode.workspace.getConfiguration('agentSkills');
        const repositories = config.get<SkillRepository[]>('skillRepositories', []);

        const generation = ++this.loadGeneration;

        if (clearCache) {
            this.githubClient.clearCache();
        }

        this.skills = [];
        this.failures = [];
        this.loadingRepos = [...repositories];
        this.isLoading = repositories.length > 0;
        this._onDidChangeTreeData.fire();

        if (repositories.length === 0) {
            this.isLoading = false;
            this._onDidChangeTreeData.fire();
            return;
        }

        await Promise.allSettled(repositories.map(async repo => {
            try {
                const repoSkills = await this.githubClient.fetchSkillsFromRepo(repo);
                if (generation !== this.loadGeneration) {
                    return;
                }
                this.skills.push(...repoSkills);
            } catch (error) {
                if (generation !== this.loadGeneration) {
                    return;
                }
                const message = error instanceof Error ? error.message : String(error);
                this.failures.push({ repo, error: message });
            } finally {
                if (generation !== this.loadGeneration) {
                    return;
                }
                this.loadingRepos = this.loadingRepos.filter(r => !this.isSameRepository(r, repo));
                this.isLoading = this.loadingRepos.length > 0;
                this._onDidChangeTreeData.fire();
            }
        }));
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
        vscode.commands.executeCommand('setContext', 'agentSkills:searchActive', this.isSearchActive());
    }

    /**
     * Update the set of installed skill names
     */
    setInstalledSkills(names: Set<string>): void {
        this.installedSkillNames = names;
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
    setTreeView(treeView: vscode.TreeView<SkillTreeItem | SourceTreeItem | FailedSourceTreeItem | LoadingSourceTreeItem>): void {
        this.treeView = treeView;
    }

    /**
     * getParent implementation required for TreeView.reveal() to work.
     * Returns the SourceTreeItem parent for a SkillTreeItem, or undefined for root items.
     */
    getParent(element: SkillTreeItem | SourceTreeItem | FailedSourceTreeItem | LoadingSourceTreeItem): vscode.ProviderResult<SkillTreeItem | SourceTreeItem | FailedSourceTreeItem | LoadingSourceTreeItem> {
        if (element instanceof SkillTreeItem) {
            const cached = this.cachedSkillItems.get(this.skillCacheKey(element.skill));
            if (cached) {
                return cached.parent;
            }
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

        // Fire a tree refresh to rebuild cached source items
        this._onDidChangeTreeData.fire();
        await new Promise(resolve => setTimeout(resolve, 150));

        // Find the parent source group and expand it (this triggers getChildren
        // which caches the child SkillTreeItems)
        const sourceItem = this.cachedSourceItems.find(s => this.isSameRepository(s.repo, skill.source));
        if (sourceItem) {
            try {
                await this.treeView.reveal(sourceItem, { select: false, focus: false, expand: true });
            } catch {
                // ignore
            }
        }

        // Brief delay for the tree to process the expansion and call getChildren
        await new Promise(resolve => setTimeout(resolve, 150));

        // Now reveal the skill item (should be cached after source expansion)
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

    getTreeItem(element: SkillTreeItem | SourceTreeItem | FailedSourceTreeItem | LoadingSourceTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SkillTreeItem | SourceTreeItem | FailedSourceTreeItem | LoadingSourceTreeItem): vscode.ProviderResult<(SkillTreeItem | SourceTreeItem | FailedSourceTreeItem | LoadingSourceTreeItem)[]> {

        if (!element) {
            // Root level
            const filteredSkills = this.getFilteredSkills();
            
            if (filteredSkills.length === 0 && this.skills.length === 0 && this.failures.length === 0 && this.loadingRepos.length === 0) {
                return [this.createEmptyItem()];
            }

            if (filteredSkills.length === 0 && this.searchQuery && this.failures.length === 0 && this.loadingRepos.length === 0) {
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
                    ...filteredSkills.map(skill => new SkillTreeItem(skill, this.installedSkillNames.has(skill.name))),
                    ...failureItems,
                    ...loadingItems
                ];
            }
        }

        if (element instanceof SourceTreeItem) {
            const items = [...element.skills]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(skill => new SkillTreeItem(skill, this.installedSkillNames.has(skill.name)));
            // Cache skill items with their parent source for getParent / reveal
            for (const item of items) {
                this.cachedSkillItems.set(this.skillCacheKey(item.skill), { item, parent: element });
            }
            return items;
        }

        return [];
    }

    private isSameRepository(left: SkillRepository, right: SkillRepository): boolean {
        return left.owner === right.owner &&
            left.repo === right.repo &&
            left.path === right.path &&
            left.branch === right.branch &&
            left.singleSkill === right.singleSkill;
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
        const groups = new Map<string, { skills: Skill[]; repo: SkillRepository }>();
        
        for (const skill of skills) {
            // Include path (and branch if non-default) in the key so the same
            // repo configured with different paths/branches stays distinct
            const key = this.repoGroupKey(skill.source);
            if (!groups.has(key)) {
                groups.set(key, { skills: [], repo: skill.source });
            }
            groups.get(key)!.skills.push(skill);
        }
        
        return Array.from(groups.entries())
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, { skills: skillList, repo }]) => {
                // Use a friendlier label: owner/repo when path is the only
                // config, otherwise append the distinguishing path
                const base = `${repo.owner}/${repo.repo}`;
                const label = this.hasMultiplePathsForRepo(repo, groups) ? `${base} (${repo.path})` : base;
                return new SourceTreeItem(label, skillList, repo);
            });
    }

    /**
     * Build a stable grouping key for a SkillRepository that includes
     * owner, repo, path, and branch so distinct configs stay separate.
     */
    private repoGroupKey(repo: SkillRepository): string {
        return `${repo.owner}/${repo.repo}/${repo.path}@${repo.branch}`;
    }

    /**
     * Check whether the same owner/repo appears more than once in the
     * current groups (i.e. configured with different paths/branches).
     */
    private hasMultiplePathsForRepo(
        repo: SkillRepository,
        groups: Map<string, { skills: Skill[]; repo: SkillRepository }>
    ): boolean {
        const base = `${repo.owner}/${repo.repo}`;
        let count = 0;
        for (const [, { repo: r }] of groups) {
            if (`${r.owner}/${r.repo}` === base) {
                count++;
                if (count > 1) { return true; }
            }
        }
        return false;
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
