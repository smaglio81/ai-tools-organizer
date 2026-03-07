/**
 * Skill Installation Service - handles installing and uninstalling skills
 */

import * as vscode from 'vscode';
import { Skill, InstalledSkill } from '../types';
import { GitHubSkillsClient } from '../github/skillsClient';
import { SkillPathService } from './skillPathService';

export class SkillInstallationService {
    constructor(
        private readonly githubClient: GitHubSkillsClient,
        private readonly context: vscode.ExtensionContext,
        private readonly pathService: SkillPathService = new SkillPathService()
    ) {}

    /**
     * Install a skill to the configured location (workspace or user home directory)
     */
    async installSkill(skill: Skill): Promise<boolean> {
        const installLocation = this.pathService.getInstallLocation();
        const workspaceFolder = this.pathService.getWorkspaceFolderForLocation(installLocation);

        if (this.pathService.requiresWorkspaceFolder(installLocation) && !workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
            return false;
        }

        const targetDir = this.pathService.resolveInstallTarget(skill.name, workspaceFolder);

        if (!targetDir) {
            vscode.window.showErrorMessage('Failed to resolve install location for this skill.');
            return false;
        }

        // Check if already installed
        try {
            await vscode.workspace.fs.stat(targetDir);
            const overwrite = await vscode.window.showWarningMessage(
                `Skill "${skill.name}" is already installed. Overwrite?`,
                { modal: true },
                'Overwrite'
            );
            if (overwrite !== 'Overwrite') {
                return false;
            }
            // Delete existing
            await vscode.workspace.fs.delete(targetDir, { recursive: true });
        } catch {
            // Not installed, continue
        }

        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Installing ${skill.name}...`,
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
                    
                    // Write file
                    await vscode.workspace.fs.writeFile(
                        filePath,
                        new TextEncoder().encode(file.content)
                    );
                    
                    written++;
                    progress.report({ 
                        increment: 50 * (written / files.length),
                        message: `Writing ${file.path}...`
                    });
                }

                vscode.window.showInformationMessage(`Successfully installed skill "${skill.name}"`);
                return true;
                
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to install skill: ${message}`);
                
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

        const confirm = await vscode.window.showWarningMessage(
            `Uninstall skill "${skill.name}"? This will delete the skill folder.`,
            { modal: true },
            'Uninstall'
        );

        if (confirm !== 'Uninstall') {
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
