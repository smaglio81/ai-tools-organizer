/**
 * Installed Skills TreeDataProvider - displays skills installed in the workspace
 */

import * as vscode from 'vscode';
import { InstalledSkill, SkillMetadata } from '../types';
import { SkillPathService } from '../services/skillPathService';

type TreeNode = LocationTreeItem | InstalledSkillTreeItem;

export class LocationTreeItem extends vscode.TreeItem {
    constructor(
        public readonly location: string,
        public readonly skills: InstalledSkill[],
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded
    ) {
        super(location, collapsibleState);
        
        this.tooltip = `${skills.length} skill${skills.length !== 1 ? 's' : ''} installed`;
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'location';
    }
}

export class InstalledSkillTreeItem extends vscode.TreeItem {
    constructor(
        public readonly installedSkill: InstalledSkill
    ) {
        super(installedSkill.name, vscode.TreeItemCollapsibleState.None);
        
        this.description = installedSkill.description;
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${installedSkill.name}**\n\n`);
        this.tooltip.appendMarkdown(`${installedSkill.description}\n\n`);
        this.tooltip.appendMarkdown(`*Location: ${installedSkill.location}*`);
        
        this.iconPath = new vscode.ThemeIcon('extensions');
        this.contextValue = 'installedSkill';
    }
}

export class InstalledSkillsTreeDataProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private installedSkills: InstalledSkill[] = [];
    private readonly pathService: SkillPathService;
    private collapsedLocations: Set<string>;
    private readonly COLLAPSED_STATE_KEY = 'agentSkills.collapsedLocations';
    private treeView?: vscode.TreeView<TreeNode>;

    constructor(
        private readonly context: vscode.ExtensionContext,
        pathService?: SkillPathService
    ) {
        this.pathService = pathService ?? new SkillPathService();
        
        // Load collapsed state
        this.collapsedLocations = new Set(
            this.context.workspaceState.get<string[]>(this.COLLAPSED_STATE_KEY, [])
        );

        // Scan installed skills on initialization
        this.scanInstalledSkills().then(skills => {
            this.installedSkills = skills;
            this._onDidChangeTreeData.fire();
        });
    }

    /**
     * Refresh the installed skills list
     */
    async refresh(): Promise<void> {
        this.installedSkills = await this.scanInstalledSkills();
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
            const groups = this.groupSkillsByLocation();
            const locationItems = Object.entries(groups).map(([location, skills]) => 
                new LocationTreeItem(location, skills, vscode.TreeItemCollapsibleState.Expanded)
            );
            
            for (const item of locationItems) {
                try {
                    await this.treeView.reveal(item, { expand: true });
                } catch {
                    // Item might not be visible yet, ignore
                }
            }
        }
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
        
        if (this.treeView) {
            const locationItems = Object.entries(groups).map(([location, skills]) => 
                new LocationTreeItem(location, skills, vscode.TreeItemCollapsibleState.Collapsed)
            );
            
            for (const item of locationItems) {
                try {
                    await this.treeView.reveal(item, { expand: false });
                } catch {
                    // Item might not be visible yet, ignore
                }
            }
        }
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
     * Group skills by their base location
     */
    private groupSkillsByLocation(): Record<string, InstalledSkill[]> {
        const groups: Record<string, InstalledSkill[]> = {};
        
        for (const skill of this.installedSkills) {
            // Extract base location (remove the skill name from the path)
            const lastSlash = skill.location.lastIndexOf('/');
            const baseLocation = lastSlash > 0 ? skill.location.substring(0, lastSlash) : skill.location;
            
            if (!groups[baseLocation]) {
                groups[baseLocation] = [];
            }
            groups[baseLocation].push(skill);
        }
        
        return groups;
    }

    /**
     * Scan workspace for installed skills
     */
    async scanInstalledSkills(): Promise<InstalledSkill[]> {
        const workspaceFolder = this.pathService.getWorkspaceFolder();

        const fileSystem = this.pathService.getFileSystem();

        const locations = this.pathService.getScanLocations();
        const installed: InstalledSkill[] = [];

        for (const location of locations) {
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
            return stat.type === vscode.FileType.Directory;
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
        // Handle collapse state changes
        if (element instanceof LocationTreeItem) {
            element.collapsibleState = this.collapsedLocations.has(element.location) 
                ? vscode.TreeItemCollapsibleState.Collapsed 
                : vscode.TreeItemCollapsibleState.Expanded;
        }
        return element;
    }

    getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]> {
        if (element instanceof InstalledSkillTreeItem) {
            // Skills have no children
            return [];
        }
        
        if (element instanceof LocationTreeItem) {
            // Return skills for this location
            return element.skills.map(skill => new InstalledSkillTreeItem(skill));
        }
        
        // Root level - return location groups
        if (this.installedSkills.length === 0) {
            return [];
        }
        
        const groups = this.groupSkillsByLocation();
        return Object.entries(groups).map(([location, skills]) => {
            const collapsibleState = this.collapsedLocations.has(location) 
                ? vscode.TreeItemCollapsibleState.Collapsed 
                : vscode.TreeItemCollapsibleState.Expanded;
            return new LocationTreeItem(location, skills, collapsibleState);
        });
    }

    /**
     * Handle tree item expansion/collapse
     */
    onDidCollapseElement(element: TreeNode): void {
        if (element instanceof LocationTreeItem) {
            this.collapsedLocations.add(element.location);
            this.saveCollapsedState();
        }
    }

    /**
     * Handle tree item expansion
     */
    onDidExpandElement(element: TreeNode): void {
        if (element instanceof LocationTreeItem) {
            this.collapsedLocations.delete(element.location);
            this.saveCollapsedState();
        }
    }
}
