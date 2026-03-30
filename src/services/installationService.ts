/**
 * Skill Installation Service - handles installing and uninstalling skills
 */

import * as vscode from 'vscode';
import { Skill, InstalledSkill, normalizeSeparators, buildGitHubUrl } from '../types';
import { GitHubSkillsClient } from '../github/skillsClient';
import { SkillPathService } from './skillPathService';

export class SkillInstallationService {
    constructor(
        private readonly githubClient: GitHubSkillsClient,
        private readonly context: vscode.ExtensionContext,
        private readonly pathService: SkillPathService = new SkillPathService()
    ) {}

    /**
     * Install a skill to the configured location (workspace or user home directory).
     * Uses the area-specific default download location based on the skill's content area.
     */
    async installSkill(skill: Skill): Promise<boolean> {
        const area = skill.area || 'skills';
        const installLocation = this.pathService.getDefaultDownloadLocation(area);
        const workspaceFolder = this.pathService.getWorkspaceFolderForLocation(installLocation);

        if (this.pathService.requiresWorkspaceFolder(installLocation) && !workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
            return false;
        }

        const targetDir = this.pathService.resolveInstallTarget(skill.name, workspaceFolder, area);

        if (!targetDir) {
            vscode.window.showErrorMessage(`Failed to resolve download location for "${skill.name}".`);
            return false;
        }

        // Check if already installed
        try {
            await vscode.workspace.fs.stat(targetDir);
            const overwrite = await vscode.window.showWarningMessage(
                `Skill "${skill.name}" is already downloaded. Overwrite?`,
                { modal: true },
                'Overwrite'
            );
            if (overwrite !== 'Overwrite') {
                return false;
            }
            // Delete existing
            await vscode.workspace.fs.delete(targetDir, { recursive: true, useTrash: true });
        } catch {
            // Not installed, continue
        }

        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Downloading ${skill.name}...`,
            cancellable: true
        }, async (progress, token) => {
            try {
                progress.report({ increment: 0, message: 'Fetching skill files...' });
                
                if (token.isCancellationRequested) {
                    return false;
                }

                // Fetch all files
                const files = await this.githubClient.fetchSkillFiles(skill);
                
                if (token.isCancellationRequested) {
                    return false;
                }

                progress.report({ increment: 50, message: 'Writing files...' });
                
                // Create target directory
                await vscode.workspace.fs.createDirectory(targetDir);
                
                // Write all files
                let written = 0;
                for (const file of files) {
                    if (token.isCancellationRequested) {
                        // Cleanup partial installation
                        await vscode.workspace.fs.delete(targetDir, { recursive: true });
                        return false;
                    }
                    
                    const filePath = vscode.Uri.joinPath(targetDir, file.path);
                    
                    // Ensure parent directory exists
                    const parentDir = vscode.Uri.joinPath(filePath, '..');
                    await vscode.workspace.fs.createDirectory(parentDir);
                    
                    // Write file, injecting source URL into SKILL.md frontmatter
                    let content = file.content;
                    if (file.path === 'SKILL.md') {
                        content = this.injectSourceFrontmatter(content, skill);
                    }

                    await vscode.workspace.fs.writeFile(
                        filePath,
                        new TextEncoder().encode(content)
                    );
                    
                    written++;
                    progress.report({ 
                        increment: 50 * (written / files.length),
                        message: `Writing ${file.path}...`
                    });
                }

                vscode.window.showInformationMessage(`Successfully downloaded "${skill.name}"`);
                return true;
                
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to download: ${message}`);
                
                // Cleanup on error
                try {
                    await vscode.workspace.fs.delete(targetDir, { recursive: true });
                } catch {
                    // Ignore cleanup errors
                }
                
                return false;
            }
        });
    }

    /**
     * Uninstall a skill from its installed location (workspace or user home directory)
     */
    async uninstallSkill(skill: InstalledSkill): Promise<boolean> {
        const workspaceFolder = this.pathService.getWorkspaceFolderForLocation(skill.location);
        if (this.pathService.requiresWorkspaceFolder(skill.location) && !workspaceFolder) {
            return false;
        }

        try {
            const skillDir = this.pathService.resolveLocationToUri(skill.location, workspaceFolder);

            if (!skillDir) {
                vscode.window.showErrorMessage('Failed to resolve skill location.');
                return false;
            }

            await vscode.workspace.fs.delete(skillDir, { recursive: true, useTrash: true });
            vscode.window.showInformationMessage(`Successfully uninstalled skill "${skill.name}"`);
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to uninstall skill: ${message}`);
            return false;
        }
    }

    /**
     * Extract the actual folder basename from a skill's location path.
     * skill.location is e.g. "~/.copilot/skills/my-skill" — the last segment
     * is the real folder name on disk, which may differ from skill.name (frontmatter).
     */
    private getSkillFolderName(skill: InstalledSkill): string {
        const normalized = normalizeSeparators(skill.location);
        const lastSlash = normalized.lastIndexOf('/');
        return lastSlash >= 0 ? normalized.substring(lastSlash + 1) : normalized;
    }

    /**
     * Move a skill from its current location to a different scan location
     */
    async moveSkill(skill: InstalledSkill): Promise<boolean> {
        const locations = this.pathService.getScanLocations();
        // skill.location includes the skill name (e.g. "~/.copilot/skills/my-skill"),
        // strip the trailing segment to get the parent scan location for display
        const currentParentLocation = normalizeSeparators(skill.location).replace(/\/[^/]+$/, '');
        // Use the actual folder name on disk, not the frontmatter name
        const folderName = this.getSkillFolderName(skill);

        // Build quick pick items, marking the current location (normalize for comparison)
        const items: vscode.QuickPickItem[] = locations.map(loc => ({
            label: loc,
            description: normalizeSeparators(loc) === currentParentLocation ? '(current)' : undefined
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Move "${skill.name}" to...`
        });

        if (!selected || normalizeSeparators(selected.label) === currentParentLocation) {
            return false;
        }

        const targetLocation = selected.label;
        const targetWorkspaceFolder = this.pathService.getWorkspaceFolderForLocation(targetLocation);

        if (this.pathService.requiresWorkspaceFolder(targetLocation) && !targetWorkspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open. Cannot move to a workspace-relative location.');
            return false;
        }

        const targetBaseUri = this.pathService.resolveLocationToUri(targetLocation, targetWorkspaceFolder);
        if (!targetBaseUri) {
            vscode.window.showErrorMessage('Failed to resolve target location.');
            return false;
        }

        const targetDir = vscode.Uri.joinPath(targetBaseUri, folderName);

        // Guard against source and target resolving to the same directory
        const sourceWorkspaceFolder = this.pathService.getWorkspaceFolderForLocation(skill.location);
        const sourceDir = this.pathService.resolveLocationToUri(skill.location, sourceWorkspaceFolder);
        if (sourceDir && targetDir.fsPath === sourceDir.fsPath) {
            vscode.window.showInformationMessage(`"${skill.name}" is already at that location.`);
            return false;
        }

        // Check if skill already exists at target
        try {
            await vscode.workspace.fs.stat(targetDir);
            const overwrite = await vscode.window.showWarningMessage(
                `"${folderName}" already exists at ${targetLocation}. Overwrite?`,
                { modal: true },
                'Overwrite'
            );
            if (overwrite !== 'Overwrite') {
                return false;
            }
            await vscode.workspace.fs.delete(targetDir, { recursive: true, useTrash: true });
        } catch {
            // Doesn't exist at target, continue
        }

        if (!sourceDir) {
            vscode.window.showErrorMessage('Failed to resolve source skill location.');
            return false;
        }

        try {
            // Ensure target parent directory exists
            await vscode.workspace.fs.createDirectory(targetBaseUri);

            // Copy source to target, then delete source (move)
            await vscode.workspace.fs.copy(sourceDir, targetDir, { overwrite: true });
            await vscode.workspace.fs.delete(sourceDir, { recursive: true, useTrash: true });

            vscode.window.showInformationMessage(`Moved "${skill.name}" to ${targetLocation}`);
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to move skill: ${message}`);
            return false;
        }
    }

    /**
     * Copy a skill to a different scan location, keeping the original in place
     */
    async copySkill(skill: InstalledSkill): Promise<boolean> {
        const locations = this.pathService.getScanLocations();
        // Strip trailing skill name to get the parent scan location for display
        const currentParentLocation = normalizeSeparators(skill.location).replace(/\/[^/]+$/, '');
        // Use the actual folder name on disk, not the frontmatter name
        const folderName = this.getSkillFolderName(skill);

        // Build quick pick items, marking the current location (normalize for comparison)
        const items: vscode.QuickPickItem[] = locations.map(loc => ({
            label: loc,
            description: normalizeSeparators(loc) === currentParentLocation ? '(current)' : undefined
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Copy "${skill.name}" to...`
        });

        if (!selected || normalizeSeparators(selected.label) === currentParentLocation) {
            return false;
        }

        const targetLocation = selected.label;
        const targetWorkspaceFolder = this.pathService.getWorkspaceFolderForLocation(targetLocation);

        if (this.pathService.requiresWorkspaceFolder(targetLocation) && !targetWorkspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open. Cannot copy to a workspace-relative location.');
            return false;
        }

        const targetBaseUri = this.pathService.resolveLocationToUri(targetLocation, targetWorkspaceFolder);
        if (!targetBaseUri) {
            vscode.window.showErrorMessage('Failed to resolve target location.');
            return false;
        }

        const targetDir = vscode.Uri.joinPath(targetBaseUri, folderName);

        // Guard against source and target resolving to the same directory
        const sourceWorkspaceFolder = this.pathService.getWorkspaceFolderForLocation(skill.location);
        const sourceDir = this.pathService.resolveLocationToUri(skill.location, sourceWorkspaceFolder);
        if (sourceDir && targetDir.fsPath === sourceDir.fsPath) {
            vscode.window.showInformationMessage(`"${skill.name}" is already at that location.`);
            return false;
        }

        // Check if skill already exists at target
        try {
            await vscode.workspace.fs.stat(targetDir);
            const overwrite = await vscode.window.showWarningMessage(
                `"${folderName}" already exists at ${targetLocation}. Overwrite?`,
                { modal: true },
                'Overwrite'
            );
            if (overwrite !== 'Overwrite') {
                return false;
            }
            await vscode.workspace.fs.delete(targetDir, { recursive: true, useTrash: true });
        } catch {
            // Doesn't exist at target, continue
        }

        if (!sourceDir) {
            vscode.window.showErrorMessage('Failed to resolve source skill location.');
            return false;
        }

        try {
            // Ensure target parent directory exists
            await vscode.workspace.fs.createDirectory(targetBaseUri);

            // Copy source to target (no delete — keep original)
            await vscode.workspace.fs.copy(sourceDir, targetDir, { overwrite: true });

            vscode.window.showInformationMessage(`Copied "${skill.name}" to ${targetLocation}`);
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to copy skill: ${message}`);
            return false;
        }
    }

    /**
     * Synchronize the newest skill copy to all other locations that have an older copy.
     * Called on the skill with status "newest".
     */
    async syncSkill(skill: InstalledSkill, allInstalled: InstalledSkill[]): Promise<boolean> {
        // Find all other copies with the same name
        const duplicates = allInstalled.filter(
            s => s.name === skill.name && s.location !== skill.location
        );

        if (duplicates.length === 0) {
            vscode.window.showInformationMessage(`No other copies of "${skill.name}" to synchronize.`);
            return false;
        }

        // Resolve source
        const sourceWorkspaceFolder = this.pathService.getWorkspaceFolderForLocation(skill.location);
        const sourceDir = this.pathService.resolveLocationToUri(skill.location, sourceWorkspaceFolder);
        if (!sourceDir) {
            vscode.window.showErrorMessage('Failed to resolve source skill location.');
            return false;
        }

        let synced = 0;
        for (const target of duplicates) {
            const targetWorkspaceFolder = this.pathService.getWorkspaceFolderForLocation(target.location);
            const targetDir = this.pathService.resolveLocationToUri(target.location, targetWorkspaceFolder);
            if (!targetDir) {
                continue;
            }

            try {
                await vscode.workspace.fs.delete(targetDir, { recursive: true, useTrash: true });
                await vscode.workspace.fs.copy(sourceDir, targetDir, { overwrite: true });
                synced++;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to sync to ${target.location}: ${message}`);
            }
        }

        if (synced > 0) {
            vscode.window.showInformationMessage(
                `Synchronized "${skill.name}" to ${synced} location${synced !== 1 ? 's' : ''}.`
            );
        }
        return synced > 0;
    }

    /**
     * Get the latest version of a skill by copying from the specified source skill.
     */
    async getLatestSkillFrom(targetSkill: InstalledSkill, sourceSkill: InstalledSkill): Promise<boolean> {
        const sourceWorkspaceFolder = this.pathService.getWorkspaceFolderForLocation(sourceSkill.location);
        const sourceDir = this.pathService.resolveLocationToUri(sourceSkill.location, sourceWorkspaceFolder);
        if (!sourceDir) {
            vscode.window.showErrorMessage('Failed to resolve source skill location.');
            return false;
        }

        const targetWorkspaceFolder = this.pathService.getWorkspaceFolderForLocation(targetSkill.location);
        const targetDir = this.pathService.resolveLocationToUri(targetSkill.location, targetWorkspaceFolder);
        if (!targetDir) {
            vscode.window.showErrorMessage('Failed to resolve target skill location.');
            return false;
        }

        try {
            await vscode.workspace.fs.delete(targetDir, { recursive: true, useTrash: true });
            await vscode.workspace.fs.copy(sourceDir, targetDir, { overwrite: true });
            vscode.window.showInformationMessage(`Updated "${targetSkill.name}" from latest copy.`);
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to get latest: ${message}`);
            return false;
        }
    }

    /**
     * Delete all skills under a location folder
     */
    async deleteAllSkillsInLocation(location: string, skills: InstalledSkill[]): Promise<boolean> {
        let deleted = 0;
        for (const skill of skills) {
            const workspaceFolder = this.pathService.getWorkspaceFolderForLocation(skill.location);
            const skillDir = this.pathService.resolveLocationToUri(skill.location, workspaceFolder);
            if (!skillDir) {
                continue;
            }

            try {
                await vscode.workspace.fs.delete(skillDir, { recursive: true, useTrash: true });
                deleted++;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to delete "${skill.name}": ${message}`);
            }
        }

        if (deleted > 0) {
            vscode.window.showInformationMessage(
                `Deleted ${deleted} skill${deleted !== 1 ? 's' : ''} from ${location}.`
            );
        }
        return deleted > 0;
    }

    /**
     * Inject an `agent-skills-source:` line into SKILL.md frontmatter pointing to the GitHub URL.
     * If frontmatter exists, replaces any existing `agent-skills-source:` line and appends the new line
     * before the closing `---`. If no frontmatter exists, wraps the content with new frontmatter.
     */
    private injectSourceFrontmatter(content: string, skill: Skill): string {
        const sourceUrl = buildGitHubUrl(skill.source.owner, skill.source.repo, skill.source.branch, skill.skillPath);
        const frontmatterMatch = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);

        if (frontmatterMatch) {
            const opening = frontmatterMatch[1];
            let body = frontmatterMatch[2];
            const closing = frontmatterMatch[3];
            const rest = content.slice(frontmatterMatch[0].length);

            // Remove any existing agent-skills-source line
            body = body.replace(/^agent-skills-source:\s.*\r?\n?/m, '').replace(/\r?\n$/, '');

            // Append as the last line of frontmatter, preserving existing newline style
            const newlineMatch = opening.match(/\r\n|\n/);
            const newline = newlineMatch ? newlineMatch[0] : '\n';

            body += `${newline}agent-skills-source: ${sourceUrl}`;

            return `${opening}${body}${closing}${rest}`;
        }

        // No frontmatter — wrap content with new frontmatter
        return `---\nagent-skills-source: ${sourceUrl}\n---\n${content}`;
    }

    /**
     * Open the skill folder in the explorer
     */
    async openSkillFolder(skill: InstalledSkill): Promise<void> {
        const workspaceFolder = this.pathService.getWorkspaceFolderForLocation(skill.location);
        if (this.pathService.requiresWorkspaceFolder(skill.location) && !workspaceFolder) {
            return;
        }

        const skillDir = this.pathService.resolveLocationToUri(skill.location, workspaceFolder);

        if (!skillDir) {
            vscode.window.showErrorMessage('Failed to resolve skill location.');
            return;
        }

        const skillMd = vscode.Uri.joinPath(skillDir, 'SKILL.md');
        
        try {
            await vscode.commands.executeCommand('revealInExplorer', skillDir);
            await vscode.window.showTextDocument(skillMd);
        } catch (_error) {
            vscode.window.showErrorMessage(`Failed to open skill folder`);
        }
    }
}
