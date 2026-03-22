/**
 * Agent Skills VS Code Extension
 * Provides a marketplace for browsing, installing, and managing Agent Skills
 */

import * as vscode from 'vscode';
import { GitHubSkillsClient } from './github/skillsClient';
import { MarketplaceTreeDataProvider, SkillTreeItem, SourceTreeItem, FailedSourceTreeItem } from './views/marketplaceProvider';
import { InstalledSkillsTreeDataProvider, InstalledSkillTreeItem, LocationTreeItem } from './views/installedProvider';
import { SkillDetailPanel } from './views/skillDetailPanel';
import { SkillInstallationService } from './services/installationService';
import { SkillPathService } from './services/skillPathService';
import { Skill, InstalledSkill, SkillRepository } from './types';

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
function parseGitHubUrl(input: string): { owner: string; repo: string; branch: string | undefined; path: string | undefined } | undefined {
    const normalized = input.trim()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '');

    if (!normalized.startsWith('github.com/')) {
        return undefined;
    }

    const parts = normalized.slice('github.com/'.length).split('/').filter(p => p.length > 0);
    if (parts.length < 2) {
        return undefined;
    }

    const owner = parts[0];
    const repo = parts[1];
    let branch: string | undefined;
    let path: string | undefined;

    // /tree/<branch>[/<path...>]
    if (parts.length >= 4 && parts[2] === 'tree') {
        branch = parts[3];
        if (parts.length > 4) {
            path = parts.slice(4).join('/');
        }
    }

    return { owner, repo, branch, path };
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Agent Skills extension is now active!');

    // Initialize services
    const githubClient = new GitHubSkillsClient(context);
    const pathService = new SkillPathService();
    const installationService = new SkillInstallationService(githubClient, context, pathService);

    // Initialize view providers
    const marketplaceProvider = new MarketplaceTreeDataProvider(githubClient, context);
    const installedProvider = new InstalledSkillsTreeDataProvider(context, pathService);

    // Register TreeViews
    const marketplaceTreeView = vscode.window.createTreeView('agentSkills.marketplace', {
        treeDataProvider: marketplaceProvider,
        showCollapseAll: true
    });

    // Pass tree view reference to marketplace provider for reveal operations
    marketplaceProvider.setTreeView(marketplaceTreeView);

    const installedTreeView = vscode.window.createTreeView('agentSkills.installed', {
        treeDataProvider: installedProvider
    });

    // Pass tree view reference to provider for expand/collapse operations
    installedProvider.setTreeView(installedTreeView);

    // Handle expand/collapse events to persist state
    installedTreeView.onDidCollapseElement(e => {
        installedProvider.onDidCollapseElement(e.element);
    });

    installedTreeView.onDidExpandElement(e => {
        installedProvider.onDidExpandElement(e.element);
    });

    // Helper to sync installed status with marketplace
    const syncInstalledStatus = async () => {
        await installedProvider.refresh();
        marketplaceProvider.setInstalledSkills(installedProvider.getInstalledSkillNames());
    };

    // Register commands
    const commands = [
        // Search skills
        vscode.commands.registerCommand('agentSkills.search', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search skills',
                placeHolder: 'Enter skill name or keyword...'
            });
            if (query !== undefined) {
                marketplaceProvider.setSearchQuery(query);
            }
        }),

        // Clear search
        vscode.commands.registerCommand('agentSkills.clearSearch', () => {
            marketplaceProvider.clearSearch();
        }),

        // Search installed skills
        vscode.commands.registerCommand('agentSkills.searchInstalled', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search installed skills',
                placeHolder: 'Enter skill name or keyword...'
            });
            if (query !== undefined) {
                installedProvider.setSearchQuery(query);
            }
        }),

        // Clear installed search
        vscode.commands.registerCommand('agentSkills.clearSearchInstalled', () => {
            installedProvider.clearSearch();
        }),

        // Refresh marketplace only
        vscode.commands.registerCommand('agentSkills.refresh', async () => {
            await marketplaceProvider.refresh();
            marketplaceProvider.setInstalledSkills(installedProvider.getInstalledSkillNames());
        }),

        // Refresh installed skills only
        vscode.commands.registerCommand('agentSkills.refreshInstalled', async () => {
            await installedProvider.refresh();
            marketplaceProvider.setInstalledSkills(installedProvider.getInstalledSkillNames());
        }),

        // View skill details - opens in editor area as WebviewPanel
        vscode.commands.registerCommand('agentSkills.viewDetails', (item: SkillTreeItem | Skill | unknown) => {
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

        // Install skill
        vscode.commands.registerCommand('agentSkills.install', async (item: SkillTreeItem | Skill) => {
            const skill = item instanceof SkillTreeItem ? item.skill : item;
            if (skill) {
                const success = await installationService.installSkill(skill);
                if (success) {
                    await syncInstalledStatus();
                }
            }
        }),

        // Uninstall skill
        vscode.commands.registerCommand('agentSkills.uninstall', async (item: InstalledSkillTreeItem | InstalledSkill | Skill) => {
            let installedSkill: InstalledSkill | undefined;
            
            // Handle different input types
            if (item instanceof InstalledSkillTreeItem) {
                installedSkill = item.installedSkill;
            } else if ('location' in item) {
                // It's an InstalledSkill
                installedSkill = item as InstalledSkill;
            } else {
                // It's a Skill - find the corresponding InstalledSkill
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
        vscode.commands.registerCommand('agentSkills.openSkillFolder', async (item: InstalledSkillTreeItem) => {
            if (item?.installedSkill) {
                await installationService.openSkillFolder(item.installedSkill);
            }
        }),

        // Move skill to a different location
        vscode.commands.registerCommand('agentSkills.moveSkill', async (item: InstalledSkillTreeItem) => {
            if (item?.installedSkill) {
                const success = await installationService.moveSkill(item.installedSkill);
                if (success) {
                    await syncInstalledStatus();
                }
            }
        }),

        // Copy skill to a different location
        vscode.commands.registerCommand('agentSkills.copySkill', async (item: InstalledSkillTreeItem) => {
            if (item?.installedSkill) {
                const success = await installationService.copySkill(item.installedSkill);
                if (success) {
                    await syncInstalledStatus();
                }
            }
        }),

        // Update older copies of a skill from the newest version
        vscode.commands.registerCommand('agentSkills.syncSkill', async (item: InstalledSkillTreeItem) => {
            if (item?.installedSkill) {
                const success = await installationService.syncSkill(
                    item.installedSkill,
                    installedProvider.getInstalledSkills()
                );
                if (success) {
                    await syncInstalledStatus();
                }
            }
        }),

        // Get latest version of a skill from the newest copy
        vscode.commands.registerCommand('agentSkills.getLatestSkill', async (item: InstalledSkillTreeItem) => {
            if (item?.installedSkill) {
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
        vscode.commands.registerCommand('agentSkills.deleteAllSkills', async (item: LocationTreeItem) => {
            if (item?.skills) {
                const success = await installationService.deleteAllSkillsInLocation(item.location, item.skills);
                if (success) {
                    await syncInstalledStatus();
                }
            }
        }),

        // Show an installed skill in the Marketplace view
        vscode.commands.registerCommand('agentSkills.showInMarketplace', async (item: InstalledSkillTreeItem) => {
            if (item?.installedSkill) {
                await marketplaceProvider.revealSkillByName(item.installedSkill.name);
            }
        }),

        // Focus marketplace view (used in welcome message)
        vscode.commands.registerCommand('agentSkills.focusMarketplace', () => {
            marketplaceTreeView.reveal(undefined as unknown as SkillTreeItem, { focus: true });
        }),

        // Select install location
        vscode.commands.registerCommand('agentSkills.selectInstallLocation', async () => {
            const config = vscode.workspace.getConfiguration('agentSkills');
            const currentValue = config.get<string>('installLocation') || '.github/skills';
            
            // Get enum values from skillPathService
            const enumValues = pathService.getScanLocations();
            
            // Build quick pick items
            const items: vscode.QuickPickItem[] = [];
            
            // Add enum values
            for (const value of enumValues) {
                items.push({
                    label: value,
                    description: value === currentValue ? '(current)' : undefined
                });
            }
            
            // Add current value if not in enum
            if (!enumValues.includes(currentValue)) {
                items.unshift({
                    label: currentValue,
                    description: '(current)'
                });
            }
            
            // Add Custom option
            items.push({
                label: 'Custom...',
                description: 'Edit in settings.json'
            });
            
            // Show quick pick
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select install location for skills'
            });
            
            if (!selected) {
                return;
            }
            
            if (selected.label === 'Custom...') {
                // Open settings.json and position cursor on agentSkills.installLocation
                await vscode.commands.executeCommand('workbench.action.openSettingsJson');
                
                // Give VS Code a moment to open the settings
                setTimeout(async () => {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        const document = editor.document;
                        const text = document.getText();
                        
                        // Find the agentSkills.installLocation setting
                        const searchPattern = '"agentSkills.installLocation"';
                        const index = text.indexOf(searchPattern);
                        
                        if (index !== -1) {
                            const position = document.positionAt(index);
                            editor.selection = new vscode.Selection(position, position);
                            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                        } else {
                            // Setting doesn't exist, add it
                            vscode.window.showInformationMessage('Add "agentSkills.installLocation" to your settings.json');
                        }
                    }
                }, 100);
            } else {
                // Update the configuration
                await config.update('installLocation', selected.label, vscode.ConfigurationTarget.Global);
                await installedProvider.refresh();
            }
        }),

        // Expand all installed skills locations
        vscode.commands.registerCommand('agentSkills.expandAll', async () => {
            await installedProvider.expandAll();
        }),

        // Collapse all installed skills locations
        vscode.commands.registerCommand('agentSkills.collapseAll', async () => {
            await installedProvider.collapseAll();
            // Use the built-in command to actually collapse the tree widget,
            // since TreeDataProvider has no API to programmatically collapse nodes.
            await vscode.commands.executeCommand('workbench.actions.treeView.agentSkills.installed.collapseAll');
        }),

        // Remove a skill repository from the marketplace
        vscode.commands.registerCommand('agentSkills.removeRepository', async (item: SourceTreeItem | FailedSourceTreeItem) => {
            const repo = item instanceof SourceTreeItem ? item.repo : item.failure.repo;

            const config = vscode.workspace.getConfiguration('agentSkills');
            const repositories = config.get<SkillRepository[]>('skillRepositories', []);
            const updated = repositories.filter(
                r => !(r.owner === repo.owner && r.repo === repo.repo && r.path === repo.path)
            );
            // Suppress the config-change full refresh — we handle it incrementally below.
            marketplaceProvider.suppressConfigRefresh();
            await config.update('skillRepositories', updated, vscode.ConfigurationTarget.Global);
            marketplaceProvider.removeRepoFromMarketplace(repo);
            marketplaceProvider.setInstalledSkills(installedProvider.getInstalledSkillNames());
        }),

        // Add a new skill repository from a GitHub URL
        vscode.commands.registerCommand('agentSkills.addRepository', async () => {
            const input = await vscode.window.showInputBox({
                prompt: 'Enter a GitHub repository URL',
                placeHolder: 'https://github.com/owner/repo  or  https://github.com/owner/repo/tree/main/skills',
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

            // Prompt for the path within the repo when it was not encoded in the URL
            let skillsPath = parsed.path;
            if (skillsPath === undefined) {
                skillsPath = await vscode.window.showInputBox({
                    prompt: `Path within ${parsed.owner}/${parsed.repo} where skills are stored`,
                    placeHolder: 'skills',
                    value: 'skills'
                });
                if (skillsPath === undefined) { return; }
            }

            const newRepo: SkillRepository = {
                owner: parsed.owner,
                repo: parsed.repo,
                path: skillsPath,
                branch
            };

            const config = vscode.workspace.getConfiguration('agentSkills');
            const repositories = config.get<SkillRepository[]>('skillRepositories', []);

            const isDuplicate = repositories.some(
                r => r.owner === newRepo.owner && r.repo === newRepo.repo && r.path === newRepo.path
            );
            if (isDuplicate) {
                vscode.window.showWarningMessage(
                    `${newRepo.owner}/${newRepo.repo} (${newRepo.path}) is already in the marketplace.`
                );
                return;
            }

            marketplaceProvider.suppressConfigRefresh();
            await config.update('skillRepositories', [...repositories, newRepo], vscode.ConfigurationTarget.Global);
            await marketplaceProvider.addRepoToMarketplace(newRepo);
            marketplaceProvider.setInstalledSkills(installedProvider.getInstalledSkillNames());
            vscode.window.showInformationMessage(`Added ${newRepo.owner}/${newRepo.repo} to the marketplace.`);
        })
    ];

    context.subscriptions.push(...commands, marketplaceTreeView, installedTreeView);

    // Watch for workspace skill folder changes (SKILL.md create/delete triggers full rescan)
    const skillFolderPaths = ['.github/skills', '.claude/skills', '.agents/skills'];
    const skillWatchers = skillFolderPaths.map(path => {
        const watcher = vscode.workspace.createFileSystemWatcher(`**/${path}/*/SKILL.md`);
        watcher.onDidCreate(() => syncInstalledStatus());
        watcher.onDidDelete(() => syncInstalledStatus());
        return watcher;
    });

    context.subscriptions.push(...skillWatchers);

    // Watch all scan locations for file changes to refresh duplicate status icons
    const duplicateWatchers = installedProvider.createFileWatchers();
    context.subscriptions.push(...duplicateWatchers);

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('agentSkills.skillRepositories')) {
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

    // Initial load - load installed skills and marketplace in parallel
    Promise.all([
        installedProvider.refresh(),
        marketplaceProvider.loadSkills()
    ]).then(() => {
        marketplaceProvider.setInstalledSkills(installedProvider.getInstalledSkillNames());
    });
}

export function deactivate() {}
