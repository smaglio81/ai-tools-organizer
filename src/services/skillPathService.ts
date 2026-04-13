/**
 * Skill Path Service - resolves skill locations across workspace and user home
 */

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ContentArea, ALL_CONTENT_AREAS } from '../types';

/**
 * Maps each content area to its `chat.*` configuration key (if one exists).
 * Areas without a config key (e.g. hooksKiro) are omitted.
 */
const AREA_CONFIG_KEYS: Partial<Record<ContentArea, string>> = {
    agents: 'chat.agentFilesLocations',
    hooksGithub: 'chat.hookFilesLocations',
    // hooksKiro has no config — the only location is .kiro/hooks
    instructions: 'chat.instructionsFilesLocations',
    plugins: 'chat.pluginLocations',
    prompts: 'chat.promptFilesLocations',
    skills: 'chat.agentSkillsLocations',
};

/**
 * Template prefixes used to build the default location list when no
 * configuration setting is available.
 */
const DEFAULT_LOCATION_PREFIXES = [
    '.agents',
    '.claude',
    '.github',
    '.kiro',
    '~/.agents',
    '~/.claude',
    '~/.copilot',
    '~/.kiro',
];

/**
 * The conventional directory name for each area (used as the last path segment).
 */
const AREA_DIR_NAMES: Record<ContentArea, string> = {
    agents: 'agents',
    hooksGithub: 'hooks',
    hooksKiro: 'hooks',
    instructions: 'instructions',
    plugins: 'plugins',
    powers: 'powers',
    prompts: 'prompts',
    skills: 'skills',
};

export class SkillPathService {
    private readonly DEFAULT_SCAN_LOCATIONS = [
        '.agents/skills',
        '.claude/skills',
        '.github/skills',
        '.kiro/skills',
        '~/.agents/skills',
        '~/.claude/skills',
        '~/.copilot/skills',
        '~/.kiro/skills'
    ];

    constructor() {}

    getScanLocations(): string[] {
        const config = vscode.workspace.getConfiguration('chat');
        const locations = config.get<string[]>('agentSkillsLocations');
        
        // Use configured locations if available, otherwise fall back to defaults
        if (locations && Array.isArray(locations) && locations.length > 0) {
            return locations;
        }
        
        return this.DEFAULT_SCAN_LOCATIONS;
    }

    /**
     * Return the list of possible download locations for a given content area.
     *
     * 1. If the area has a `chat.*` configuration key and it contains values, use those.
     * 2. Otherwise build a default list from the template prefixes + area directory name.
     * 3. Special case: hooksKiro only ever returns ['.kiro/hooks'].
     */
    getDefaultDownloadLocations(area: ContentArea): string[] {
        // hooksKiro is fixed — only one possible location
        if (area === 'hooksKiro') {
            return ['.kiro/hooks'];
        }

        // Check for a configuration setting
        const configKey = AREA_CONFIG_KEYS[area];
        if (configKey) {
            const [section, key] = configKey.split('.');
            const config = vscode.workspace.getConfiguration(section);
            const locations = config.get<string[]>(key);
            if (locations && Array.isArray(locations) && locations.length > 0) {
                return locations;
            }
        }

        // Build default list from template prefixes
        const dirName = AREA_DIR_NAMES[area];
        return DEFAULT_LOCATION_PREFIXES.map(prefix => `${prefix}/${dirName}`);
    }

    /**
     * Get the currently configured default download location for an area.
     * Falls back to ~/.copilot/{area}.
     */
    getDefaultDownloadLocation(area: ContentArea): string {
        // hooksKiro is fixed
        if (area === 'hooksKiro') {
            return '.kiro/hooks';
        }

        const config = vscode.workspace.getConfiguration('AIToolsOrganizer');
        const locations = config.get<Record<string, string>>('installLocations');
        if (locations && locations[area]) {
            return locations[area];
        }

        // Fallback: ~/.copilot/{area}
        const dirName = AREA_DIR_NAMES[area];
        return `~/.copilot/${dirName}`;
    }

    /**
     * Persist the default download location for an area.
     */
    async setDefaultDownloadLocation(area: ContentArea, location: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('AIToolsOrganizer');
        const current = config.get<Record<string, string>>('installLocations') || {};
        const updated = { ...current, [area]: location };
        await config.update('installLocations', updated, vscode.ConfigurationTarget.Global);
    }

    /**
     * Ensure `AIToolsOrganizer.installLocations` exists in settings.
     * If the setting is empty or missing, create it with defaults of ~/.copilot/{area} for each area.
     */
    async ensureInstallLocations(): Promise<void> {
        const config = vscode.workspace.getConfiguration('AIToolsOrganizer');
        const existing = config.get<Record<string, string>>('installLocations');

        // If the setting already has entries, nothing to do
        if (existing && Object.keys(existing).length > 0) {
            return;
        }

        // Build defaults: ~/.copilot/{area} for each area (hooksKiro is fixed to .kiro/hooks)
        const defaults: Record<string, string> = {};
        for (const area of ALL_CONTENT_AREAS) {
            if (area === 'hooksKiro') {
                defaults[area] = '.kiro/hooks';
            } else {
                const dirName = AREA_DIR_NAMES[area];
                defaults[area] = `~/.copilot/${dirName}`;
            }
        }

        await config.update('installLocations', defaults, vscode.ConfigurationTarget.Global);
    }

    getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
        return vscode.workspace.workspaceFolders?.[0];
    }

    getFileSystem(): vscode.FileSystem {
        return vscode.workspace.fs;
    }

    getHomeDirectory(): string {
        return os.homedir();
    }

    getInstallLocation(): string {
        return this.getDefaultDownloadLocation('skills');
    }

    isHomeLocation(location: string): boolean {
        const loc = location.trim();
        return loc.startsWith('~');
    }

    requiresWorkspaceFolder(location: string): boolean {
        return !this.isHomeLocation(location);
    }

    getWorkspaceFolderForLocation(location: string): vscode.WorkspaceFolder | undefined {
        if (!this.requiresWorkspaceFolder(location)) {
            return undefined;
        }

        return this.getWorkspaceFolder();
    }

    resolveLocationToUri(location: string, workspaceFolder?: vscode.WorkspaceFolder): vscode.Uri | undefined {
        const loc = location.trim();
        if (this.isHomeLocation(loc)) {
            const resolvedPath = path.join(this.getHomeDirectory(), loc.slice(1).replace(/^[/\\]+/, ''));
            return vscode.Uri.file(this.normalizePath(resolvedPath));
        }

        if (!workspaceFolder) {
            return undefined;
        }

        const segments = this.normalizeWorkspaceLocation(loc).split(/[\\/]+/).filter(s => s.length > 0);
        return vscode.Uri.joinPath(workspaceFolder.uri, ...segments);
    }

    resolveInstallTarget(skillName: string, workspaceFolder?: vscode.WorkspaceFolder, area?: ContentArea): vscode.Uri | undefined {
        const trimmed = skillName.trim();
        if (!trimmed || trimmed === '.' || /[/\\]/.test(trimmed) || trimmed.includes('..')) {
            return undefined;
        }

        const installLocation = area ? this.getDefaultDownloadLocation(area) : this.getInstallLocation();
        const resolvedWorkspaceFolder = workspaceFolder ?? this.getWorkspaceFolderForLocation(installLocation);
        const baseDir = this.resolveLocationToUri(installLocation, resolvedWorkspaceFolder);

        if (!baseDir) {
            return undefined;
        }

        return vscode.Uri.joinPath(baseDir, trimmed);
    }

    private normalizeWorkspaceLocation(location: string): string {
        const normalized = path.posix.normalize(location.replace(/\\/g, '/'));
        const root = path.posix.parse(normalized).root;
        if (normalized.length <= root.length) {
            return normalized;
        }

        return normalized.replace(/\/+$/, '');
    }

    private normalizePath(value: string): string {
        const normalized = path.normalize(value);
        const root = path.parse(normalized).root;
        if (normalized.length <= root.length) {
            return normalized;
        }

        return normalized.replace(/[\\/]+$/, '');
    }
}
