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
    // rules: no VS Code/Cursor chat.* setting exists yet for rule file locations
    skills: 'chat.agentSkillsLocations',
};

/**
 * Template prefixes used to build the default location list when no
 * configuration setting is available.
 */
const DEFAULT_LOCATION_PREFIXES = [
    '.agents',
    '.claude',
    '.cursor',
    '.github',
    '.kiro',
    '~/.agents',
    '~/.claude',
    '~/.copilot',
    '~/.cursor',
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
    rules: 'rules',
    skills: 'skills',
};

/**
 * Areas with a Cursor-specific install root that differs from the generic
 * `~/.cursor/<dirName>` pattern produced by the default prefix list.
 * Values are appended (deduped) to whatever the config or default list produces.
 */
const CURSOR_EXTRA_LOCATIONS: Partial<Record<ContentArea, string[]>> = {
    // Cursor user plugins are installed under ~/.cursor/plugins/local/<plugin-name>
    // The scan parent must be "local", not "plugins", to avoid treating "local" itself as a plugin.
    plugins: ['~/.cursor/plugins/local'],
};

export class SkillPathService {
    constructor() {}

    getScanLocations(): string[] {
        return this.getDefaultDownloadLocations('skills');
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

        // Check for a configuration setting.
        // Supported shapes:
        // - object map: paths are enabled unless explicitly set to false
        // - legacy string array: all listed paths are treated as enabled
        const configKey = AREA_CONFIG_KEYS[area];
        if (configKey) {
            const [section, key] = configKey.split('.');
            const config = vscode.workspace.getConfiguration(section);
            const raw = config.get<unknown>(key);
            
            // Support old array format (backward compatibility)
            if (Array.isArray(raw) && raw.length > 0) {
                const strings = raw
                    .filter((item): item is string => typeof item === 'string')
                    .map(s => s.trim())
                    .filter(s => s.length > 0);
                if (strings.length > 0) {
                    return strings;
                }
            }
            
            // Support new object map format: Record<string, unknown> (only `false` disables a path)
            if (raw !== null && raw !== undefined && typeof raw === 'object' && !Array.isArray(raw)) {
                const locationMap = raw as Record<string, unknown>;
                const enabled = Object.entries(locationMap)
                    .filter(([, value]) => value !== false)
                    .map(([path]) => path.trim())
                    .filter(p => p.length > 0);
                if (enabled.length > 0) {
                    return enabled;
                }
            }
        }

        // Build default list from template prefixes
        const dirName = AREA_DIR_NAMES[area];
        const defaults = DEFAULT_LOCATION_PREFIXES.map(prefix => `${prefix}/${dirName}`);

        // Append any Cursor-specific extra locations (deduped) only when running in Cursor
        if (this.isCursor()) {
            const extras = CURSOR_EXTRA_LOCATIONS[area];
            if (extras) {
                for (const extra of extras) {
                    if (!defaults.includes(extra)) {
                        defaults.push(extra);
                    }
                }
            }

            // Under ~/.cursor/plugins, real user plugins live in the `local` subdirectory.
            // Treating `~/.cursor/plugins` as a scan root mis-classifies `local` as a plugin folder.
            if (area === 'plugins') {
                return defaults.filter(p => p !== '~/.cursor/plugins' && p !== '.cursor/plugins');
            }
        }

        return defaults;
    }

    /**
     * Returns true when the extension is running inside Cursor.
     */
    protected isCursor(): boolean {
        return vscode.env.appName === 'Cursor';
    }

    /**
     * Get the currently configured default download location for an area.
     * Falls back to ~/.cursor/{area} in Cursor, or ~/.copilot/{area} elsewhere.
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

        // Cursor-native areas use their own install roots rather than ~/.copilot
        if (this.isCursor()) {
            if (area === 'plugins') {
                return '~/.cursor/plugins/local';
            }
            if (area === 'rules') {
                return '~/.cursor/rules';
            }
        }

        // Fallback: Cursor → ~/.cursor/{area}, others → ~/.copilot/{area}
        const dirName = AREA_DIR_NAMES[area];
        return this.isCursor() ? `~/.cursor/${dirName}` : `~/.copilot/${dirName}`;
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
     * If the setting is empty or missing, create it with per-IDE defaults:
     * Cursor → ~/.cursor/{area}, others → ~/.copilot/{area}.
     */
    async ensureInstallLocations(): Promise<void> {
        const config = vscode.workspace.getConfiguration('AIToolsOrganizer');
        const existing = config.get<Record<string, string>>('installLocations') ?? {};

        // If the user (or workspace) already persisted any paths, do not overwrite.
        // Empty `{}` from package.json defaults → seed per-IDE paths on first activation.
        if (Object.keys(existing).length > 0) {
            return;
        }

        const cursor = this.isCursor();

        // Build defaults per area.
        const defaults: Record<string, string> = {};
        for (const area of ALL_CONTENT_AREAS) {
            if (area === 'hooksKiro') {
                defaults[area] = '.kiro/hooks';
            } else if (cursor && area === 'plugins') {
                defaults[area] = '~/.cursor/plugins/local';
            } else if (cursor && area === 'rules') {
                defaults[area] = '~/.cursor/rules';
            } else {
                const dirName = AREA_DIR_NAMES[area];
                defaults[area] = cursor ? `~/.cursor/${dirName}` : `~/.copilot/${dirName}`;
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
