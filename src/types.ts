/**
 * AI Tools Organizer type definitions
 */

import * as vscode from 'vscode';
import { parseAzureDevOpsGitUrl } from './git/azureDevOpsUrl';

/**
 * The recognized content areas in a repository.
 * Each area has its own detection pattern and display behavior.
 */
export type ContentArea = 'agents' | 'hooksGithub' | 'hooksKiro' | 'instructions' | 'plugins' | 'powers' | 'prompts' | 'rules' | 'skills';

/**
 * All recognized content areas in display order.
 */
export const ALL_CONTENT_AREAS: ContentArea[] = ['agents', 'hooksGithub', 'hooksKiro', 'instructions', 'plugins', 'prompts', 'rules', 'skills'];

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
    /**
     * For singleFile areas: the primary suffix to match (e.g. '.agent.md').
     * Used as the scaffold default and kept for backward-compatibility.
     * When `fileSuffixes` is also present, `fileSuffixes` drives matching and
     * `fileSuffix` is used only when creating new items.
     */
    fileSuffix?: string;
    /**
     * For singleFile areas: all accepted suffixes in priority order.
     * The first matching suffix is stripped to derive the display name.
     * When absent, falls back to `fileSuffix`.
     */
    fileSuffixes?: string[];
    /** For multiFile areas: the primary definition file (e.g. 'plugin.json', 'SKILL.md') */
    definitionFile?: string;
    /**
     * For multiFile areas: additional definition file paths to try when `definitionFile`
     * is not present at the folder root. Tried in order after `definitionFile`.
     * Paths may include subdirectories (e.g. '.cursor-plugin/plugin.json').
     */
    alternateDefinitionFiles?: string[];
    /** If true, only discover via conventional top-level directory name (skip fallback search) */
    conventionalOnly?: boolean;
    /** Override the icon file prefix (defaults to the area key). Used when two areas share icons. */
    iconPrefix?: string;
    /** Override the conventional directory name to search (defaults to the area key). */
    conventionalDir?: string;
}

export const AREA_DEFINITIONS: Record<ContentArea, AreaDefinition> = {
    agents: {
        label: 'Agents',
        groupIcon: 'hubot',
        kind: 'singleFile',
        fileSuffix: '.agent.md',
        // Cursor also accepts bare .md, .mdc, .markdown for agents
        fileSuffixes: ['.agent.md', '.agent.mdc', '.mdc', '.md', '.markdown'],
        // Suffixes are too generic (.md) to safely discover outside a conventional agents/ dir
        conventionalOnly: true,
    },
    hooksGithub: { label: 'Hooks - GitHub', groupIcon: 'git-commit', kind: 'multiFile', definitionFile: 'hooks.json', conventionalOnly: true, iconPrefix: 'hooks', conventionalDir: 'hooks' },
    hooksKiro: { label: 'Hooks - Kiro', groupIcon: 'git-commit', kind: 'singleFile', fileSuffix: '.json', conventionalOnly: true, iconPrefix: 'hooks', conventionalDir: 'hooks' },
    instructions: { label: 'Instructions', groupIcon: 'note', kind: 'singleFile', fileSuffix: '.instructions.md' },
    plugins: {
        label: 'Plugins',
        groupIcon: 'plug',
        kind: 'multiFile',
        definitionFile: 'plugin.json',
        // Cursor's canonical manifest lives under .cursor-plugin/
        alternateDefinitionFiles: ['.cursor-plugin/plugin.json'],
    },
    powers: { label: 'Powers', groupIcon: 'zap', kind: 'multiFile', definitionFile: 'POWER.md' },
    prompts: {
        label: 'Prompts / Commands',
        groupIcon: 'comment-discussion',
        kind: 'singleFile',
        fileSuffix: '.prompt.md',
        // Cursor also accepts bare .md, .mdc, .markdown, .txt for commands
        fileSuffixes: ['.prompt.md', '.prompt.mdc', '.mdc', '.md', '.markdown', '.txt'],
        // Suffixes are too generic (.md, .txt) to safely discover outside a conventional prompts/ dir
        conventionalOnly: true,
    },
    rules: {
        label: 'Rules',
        groupIcon: 'law',
        kind: 'singleFile',
        fileSuffix: '.mdc',
        fileSuffixes: ['.mdc', '.md', '.markdown'],
        conventionalDir: 'rules',
        // Suffixes are too generic (.md, .mdc) to safely discover outside a conventional rules/ dir
        conventionalOnly: true,
    },
    skills: { label: 'Skills', groupIcon: 'package', kind: 'multiFile', definitionFile: 'SKILL.md' },
};

/**
 * Return the effective list of suffixes for a singleFile area definition.
 * Prefers `fileSuffixes` when present, otherwise wraps `fileSuffix`.
 */
export function getAreaFileSuffixes(def: AreaDefinition): string[] {
    if (def.fileSuffixes && def.fileSuffixes.length > 0) {
        return def.fileSuffixes;
    }
    return def.fileSuffix ? [def.fileSuffix] : [];
}

/**
 * Derive the display name from a filename by stripping the first matching suffix
 * from the area's suffix list. Returns the full filename when no suffix matches.
 */
export function deriveItemName(fileName: string, def: AreaDefinition): string {
    for (const suffix of getAreaFileSuffixes(def)) {
        if (fileName.endsWith(suffix)) {
            return fileName.slice(0, fileName.length - suffix.length);
        }
    }
    return fileName;
}

/**
 * Return true if the filename matches any suffix in the area's suffix list.
 */
export function fileMatchesArea(fileName: string, def: AreaDefinition): boolean {
    return getAreaFileSuffixes(def).some(s => fileName.endsWith(s));
}

/**
 * Paths object mapping each content area to its path within the repository.
 * Only areas that exist in the repo will have entries.
 */
export type AreaPaths = Partial<Record<ContentArea, string>>;


/**
 * Configuration for a repository source.
 * GitHub: `owner` + `repo` (+ `branch`). Do not set `project`.
 * Azure DevOps: `owner` (organization), `project`, `repo`, `branch`.
 *
 * When `repositoryUrl` is an Azure DevOps Git URL (`dev.azure.com` / `*.visualstudio.com`
 * with `/_git/`), the extension restores `owner`, `project`, and `repo` from that URL if
 * they are missing from settings — so the Azure transport is still used even if the
 * settings UI or sync dropped the `project` field.
 */
export interface SkillRepository {
    owner: string;
    repo: string;
    branch: string;
    /** Azure DevOps project name. Present only for ADO repos. */
    project?: string;
    /**
     * Canonical repository URL without credentials, as captured when adding via URL.
     * Used to recover Azure DevOps identity when `project` is absent from stored settings.
     */
    repositoryUrl?: string;
}

/**
 * Merge stored fields with identity parsed from `repositoryUrl` when it is an ADO Git URL.
 * Branch from settings wins unless unset (then URL `version=GB` is used, else `main`).
 */
export function resolveSkillRepositoryFromConfig(repo: SkillRepository): SkillRepository {
    const rawBranch = repo.branch?.trim();
    const n = normalizeRepository(repo);
    const url = n.repositoryUrl?.trim();
    if (!url) {
        return n;
    }
    const parsed = parseAzureDevOpsGitUrl(url);
    if (!parsed) {
        return n;
    }
    return {
        ...n,
        owner: parsed.owner,
        project: parsed.project,
        repo: parsed.repo,
        branch: rawBranch || parsed.branch || 'main',
    };
}

/** Returns true when the repository should use the Azure DevOps Git transport. */
export function isAdoRepository(repo: SkillRepository): boolean {
    const r = resolveSkillRepositoryFromConfig(repo);
    return typeof r.project === 'string' && r.project.length > 0;
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
 * Regex matching all valid YAML block scalar indicators.
 * Covers folded (>) and literal (|) with optional chomping (+/-) and a single indentation digit (1-9),
 * allowing the chomping and indentation indicators in either order.
 */
const BLOCK_SCALAR_RE = /^[>|](?:[+-]?[1-9]|[1-9]?[+-])?$/;

/**
 * Returns true if the value is a YAML block scalar indicator (e.g. >, |, >-, |-, >2, |+, >2-, |1+).
 */
export function isYamlBlockScalar(value: string): boolean {
    return BLOCK_SCALAR_RE.test(value);
}

/**
 * Strip surrounding single or double quotes from a YAML string value.
 * Only strips when both sides use the same quote character.
 */
export function stripYamlQuotes(value: string): string {
    if (value.length >= 2) {
        const firstChar = value[0];
        const lastChar = value[value.length - 1];
        if ((firstChar === '"' || firstChar === "'") && firstChar === lastChar) {
            return value.slice(1, -1);
        }
    }
    return value;
}

/**
 * Collect the multiline block scalar content following a key in YAML lines.
 * Returns the joined text (space-joined for folded `>`, newline-joined for literal `|`).
 * Blank lines within the block are preserved. Indentation is dedented by the block's
 * base indentation level rather than fully trimmed.
 * @param lines All YAML lines
 * @param startIndex Index of the line containing the key (content starts at startIndex + 1)
 * @param indicator The block scalar indicator character (first char: '>' or '|')
 */
export function collectBlockScalarValue(lines: string[], startIndex: number, indicator: string): string {
    const parts: string[] = [];
    let blockIndent: number | undefined;

    for (let i = startIndex + 1; i < lines.length; i++) {
        // Strip trailing \r from CRLF line endings
        const line = lines[i].replace(/\r$/, '');

        if (line.trim() === '') {
            parts.push('');
            continue;
        }

        const indentMatch = line.match(/^(\s+)/);
        if (!indentMatch) {
            break;
        }

        const indent = indentMatch[1].length;
        if (blockIndent === undefined) {
            blockIndent = indent;
        }

        if (indent < blockIndent) {
            break;
        }

        parts.push(line.slice(blockIndent));
    }

    if (parts.length === 0) {
        return '';
    }

    if (indicator.startsWith('|')) {
        return parts.join('\n').trim();
    }

    // Folded block: join non-blank lines with spaces, preserve blank-line paragraph breaks
    let result = '';
    let pendingBlankLines = 0;
    for (const part of parts) {
        if (part === '') {
            pendingBlankLines++;
            continue;
        }

        if (result.length > 0) {
            result += pendingBlankLines > 0 ? '\n'.repeat(pendingBlankLines + 1) : ' ';
        }

        result += part;
        pendingBlankLines = 0;
    }

    return result.trim();
}

/**
 * Compare two SkillRepository configs for identity equality.
 * Compares owner, repo, branch, and (for ADO repos) project.
 */
export function isSameRepository(left: SkillRepository, right: SkillRepository): boolean {
    const l = resolveSkillRepositoryFromConfig(left);
    const r = resolveSkillRepositoryFromConfig(right);
    return l.owner === r.owner &&
        l.repo === r.repo &&
        l.branch === r.branch &&
        (l.project || '') === (r.project || '');
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
 * @deprecated Use buildRepoWebUrl instead.
 */
export function buildGitHubUrl(owner: string, repo: string, branch: string, skillPath: string): string {
    const safeBranch = encodeURIComponent(branch);
    const safePath = skillPath.split('/').map(encodeURIComponent).join('/');
    return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree/${safeBranch}/${safePath}`;
}

/**
 * Build a web browser URL for a repository path, handling both GitHub and Azure DevOps.
 * @param repo  Source repository config.
 * @param opts  `kind`: whether to link to a tree (directory) or blob (file).
 *              `path`: the path within the repo (empty string for repo root).
 */
export function buildRepoWebUrl(repo: SkillRepository, opts: { kind: 'tree' | 'blob'; path: string }): string {
    const { kind, path } = opts;
    const r = resolveSkillRepositoryFromConfig(repo);
    if (isAdoRepository(r)) {
        const base = `https://dev.azure.com/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.project!)}/_git/${encodeURIComponent(r.repo)}`;
        const params = new URLSearchParams();
        if (path) { params.set('path', path.startsWith('/') ? path : `/${path}`); }
        params.set('version', `GB${r.branch}`);
        return `${base}?${params.toString()}`;
    }
    const safeBranch = encodeURIComponent(r.branch);
    const safePath = path.split('/').map(encodeURIComponent).join('/');
    if (kind === 'blob') {
        return `https://github.com/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}/blob/${safeBranch}/${safePath}`;
    }
    return `https://github.com/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}/tree/${safeBranch}/${safePath}`;
}

/**
 * Return a concise human-readable label for a repository.
 * GitHub: "owner/repo"
 * Azure DevOps: "owner/project/repo"
 */
export function formatRepoLabel(repo: SkillRepository): string {
    const r = resolveSkillRepositoryFromConfig(repo);
    if (isAdoRepository(r)) {
        return `${r.owner}/${r.project}/${r.repo}`;
    }
    return `${r.owner}/${r.repo}`;
}

/**
 * Normalize a SkillRepository read from user config.
 * Ensures branch defaults to 'main' when omitted.
 */
export function normalizeRepository(repo: SkillRepository): SkillRepository {
    const normalized: SkillRepository = {
        ...repo,
        branch: repo.branch || 'main'
    };
    const ru = normalized.repositoryUrl?.trim();
    normalized.repositoryUrl = ru || undefined;
    // Remove project when empty so ADO discriminator stays clean
    if (normalized.project !== undefined && normalized.project.length === 0) {
        delete normalized.project;
    }
    return normalized;
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
        return resolveSkillRepositoryFromConfig(normalizeRepository(entry as SkillRepository));
    }
    return undefined;
}

/**
 * Read the skillRepositories config, handling both string[] and object[] formats.
 * Returns normalized SkillRepository[].
 */
export function readRepositoriesConfig(): SkillRepository[] {
    const config = vscode.workspace.getConfiguration('AIToolsOrganizer');
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
    const config = vscode.workspace.getConfiguration('AIToolsOrganizer');
    const normalized = repos.map(r => {
        const entry: Record<string, string> = { owner: r.owner, repo: r.repo, branch: r.branch || 'main' };
        if (r.project) { entry['project'] = r.project; }
        if (r.repositoryUrl) { entry['repositoryUrl'] = r.repositoryUrl; }
        return entry;
    });
    await config.update('skillRepositories', normalized, vscode.ConfigurationTarget.Global);
}
