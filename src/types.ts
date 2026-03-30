/**
 * Agent Organizer type definitions
 */

import * as vscode from 'vscode';

/**
 * The recognized content areas in a repository.
 * Each area has its own detection pattern and display behavior.
 */
export type ContentArea = 'agents' | 'hooksGithub' | 'hooksKiro' | 'instructions' | 'plugins' | 'powers' | 'prompts' | 'skills';

/**
 * All recognized content areas in display order.
 */
export const ALL_CONTENT_AREAS: ContentArea[] = ['agents', 'hooksGithub', 'hooksKiro', 'instructions', 'plugins', 'prompts', 'skills'];

/**
 * Metadata about each content area: how to detect it and what files define items.
 */
export interface AreaDefinition {
    /** Display label for the area group node */
    label: string;
    /** VS Code theme icon id for the group node */
    groupIcon: string;
    /** Whether items are single files or multi-file folders */
    kind: 'singleFile' | 'multiFile';
    /** For singleFile areas: glob-like suffix to match (e.g. '.agent.md') */
    fileSuffix?: string;
    /** For multiFile areas: the definition file that must exist at the folder root */
    definitionFile?: string;
    /** If true, only discover via conventional top-level directory name (skip fallback search) */
    conventionalOnly?: boolean;
    /** Override the icon file prefix (defaults to the area key). Used when two areas share icons. */
    iconPrefix?: string;
    /** Override the conventional directory name to search (defaults to the area key). */
    conventionalDir?: string;
}

export const AREA_DEFINITIONS: Record<ContentArea, AreaDefinition> = {
    agents: { label: 'Agents', groupIcon: 'hubot', kind: 'singleFile', fileSuffix: '.agent.md' },
    hooksGithub: { label: 'Hooks - GitHub', groupIcon: 'git-commit', kind: 'multiFile', definitionFile: 'hooks.json', conventionalOnly: true, iconPrefix: 'hooks', conventionalDir: 'hooks' },
    hooksKiro: { label: 'Hooks - Kiro', groupIcon: 'git-commit', kind: 'singleFile', fileSuffix: '.json', conventionalOnly: true, iconPrefix: 'hooks', conventionalDir: 'hooks' },
    instructions: { label: 'Instructions', groupIcon: 'note', kind: 'singleFile', fileSuffix: '.instructions.md' },
    plugins: { label: 'Plugins', groupIcon: 'plug', kind: 'multiFile', definitionFile: 'plugin.json' },
    powers: { label: 'Powers', groupIcon: 'zap', kind: 'multiFile', definitionFile: 'POWER.md' },
    prompts: { label: 'Prompts / Commands', groupIcon: 'comment-discussion', kind: 'singleFile', fileSuffix: '.prompt.md' },
    skills: { label: 'Skills', groupIcon: 'package', kind: 'multiFile', definitionFile: 'SKILL.md' },
};

/**
 * Paths object mapping each content area to its path within the repository.
 * Only areas that exist in the repo will have entries.
 */
export type AreaPaths = Partial<Record<ContentArea, string>>;


/**
 * Configuration for a repository source.
 */
export interface SkillRepository {
    owner: string;
    repo: string;
    branch: string;
}

/**
 * Parsed SKILL.md / POWER.md frontmatter metadata
 */
export interface SkillMetadata {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    metadata?: Record<string, string>;
    allowedTools?: string;
}

/**
 * A single-file area item (agent, hook, instruction, prompt)
 */
export interface AreaFileItem {
    /** Display name derived from filename */
    name: string;
    /** Relative path within the repo */
    filePath: string;
    /** The content area this belongs to */
    area: ContentArea;
    /** Source repository */
    source: SkillRepository;
    /** Optional description from frontmatter */
    description?: string;
    /** Full file content */
    fullContent?: string;
    /** Subfolder path within the area (empty string for root-level files) */
    folderPath: string;
}

/**
 * Full skill/plugin/power information including source
 */
export interface Skill {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    source: SkillRepository;
    skillPath: string;
    /** The content area this belongs to */
    area: ContentArea;
    fullContent?: string;
    bodyContent?: string;
    /** Raw definition file content (e.g. plugin.json, hooks.json) for JSON-based areas */
    definitionContent?: string;
}

/**
 * A repository that failed to load, with the error message preserved for display
 */
export interface FailedRepository {
    repo: SkillRepository;
    error: string;
}

/**
 * Installed skill with local path information
 */
export interface InstalledSkill {
    name: string;
    description: string;
    location: string;
    installedAt: string;
    source?: SkillRepository;
}

/**
 * GitHub API directory content item
 */
export interface GitHubContentItem {
    name: string;
    path: string;
    sha: string;
    type: 'file' | 'dir';
    download_url: string | null;
    url: string;
    size?: number;
}

/**
 * GitHub API tree item for recursive fetches
 */
export interface GitHubTreeItem {
    path: string;
    mode: string;
    type: 'blob' | 'tree';
    sha: string;
    size?: number;
    url: string;
}

/**
 * Cache entry for marketplace data
 */
export interface CacheEntry<T> {
    data: T;
    timestamp: number;
    etag?: string;
}

/**
 * All items discovered in a repository, grouped by area.
 */
export interface RepoContent {
    skills: Skill[];
    fileItems: AreaFileItem[];
}

/**
 * Compare two SkillRepository configs for identity equality.
 * Compares owner, repo, and branch.
 */
export function isSameRepository(left: SkillRepository, right: SkillRepository): boolean {
    return left.owner === right.owner &&
        left.repo === right.repo &&
        left.branch === right.branch;
}

/**
 * Normalize path separators to forward slashes so string comparisons
 * work consistently regardless of OS separator style.
 */
export function normalizeSeparators(location: string): string {
    return location.replace(/\\/g, '/');
}

/**
 * Build a GitHub URL for a skill or repository path.
 */
export function buildGitHubUrl(owner: string, repo: string, branch: string, skillPath: string): string {
    const safeBranch = encodeURIComponent(branch);
    const safePath = skillPath.split('/').map(encodeURIComponent).join('/');
    return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree/${safeBranch}/${safePath}`;
}

/**
 * Normalize a SkillRepository read from user config.
 * Ensures branch defaults to 'main' when omitted.
 */
export function normalizeRepository(repo: SkillRepository): SkillRepository {
    return {
        ...repo,
        branch: repo.branch || 'main'
    };
}

/**
 * Parse a repository config entry which may be either:
 * - A string in "owner/repo@branch" format (fallback for manual/non-standard config entries)
 * - An object with { owner, repo, branch } (standard format used by the Settings UI)
 * Returns a normalized SkillRepository, or undefined if unparseable.
 */
export function parseRepositoryEntry(entry: string | SkillRepository): SkillRepository | undefined {
    if (typeof entry === 'string') {
        const atIdx = entry.indexOf('@');
        const ownerRepo = atIdx > 0 ? entry.substring(0, atIdx) : entry;
        const branch = atIdx > 0 ? entry.substring(atIdx + 1) : 'main';
        const slashIdx = ownerRepo.indexOf('/');
        if (slashIdx <= 0 || slashIdx === ownerRepo.length - 1) { return undefined; }
        return { owner: ownerRepo.substring(0, slashIdx), repo: ownerRepo.substring(slashIdx + 1), branch: branch || 'main' };
    }
    if (entry && typeof entry === 'object' && entry.owner && entry.repo) {
        return normalizeRepository(entry);
    }
    return undefined;
}

/**
 * Read the skillRepositories config, handling both string[] and object[] formats.
 * Returns normalized SkillRepository[].
 */
export function readRepositoriesConfig(): SkillRepository[] {
    const config = vscode.workspace.getConfiguration('agentOrganizer');
    const raw = config.get<(string | SkillRepository)[]>('skillRepositories', []);
    const repos: SkillRepository[] = [];
    for (const entry of raw) {
        const parsed = parseRepositoryEntry(entry);
        if (parsed) { repos.push(parsed); }
    }
    return repos;
}

/**
 * Write the skillRepositories config as object[] for Settings UI compatibility.
 */
export async function writeRepositoriesConfig(repos: SkillRepository[]): Promise<void> {
    const config = vscode.workspace.getConfiguration('agentOrganizer');
    const normalized = repos.map(r => ({ owner: r.owner, repo: r.repo, branch: r.branch || 'main' }));
    await config.update('skillRepositories', normalized, vscode.ConfigurationTarget.Global);
}
