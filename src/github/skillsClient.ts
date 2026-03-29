/**
 * GitHub API client for fetching Agent Organizer from repositories
 * 
 * OPTIMIZATION: Uses Git Trees API (1 call per repo) + raw.githubusercontent.com 
 * (no rate limit) to minimize GitHub API usage.
 * 
 * Before: O(N) API calls where N = total skills across all repos
 * After: O(R) API calls where R = number of repositories (typically 1-4)
 */

import * as vscode from 'vscode';
import { Skill, SkillRepository, SkillMetadata, CacheEntry, FailedRepository, readRepositoriesConfig, ContentArea, ALL_CONTENT_AREAS, AREA_DEFINITIONS, AreaFileItem, RepoContent, AreaPaths } from '../types';

/**
 * GitHub Git Tree item from Trees API
 */
interface GitTreeItem {
    path: string;
    mode: string;
    type: 'blob' | 'tree';
    sha: string;
    size?: number;
    url?: string;
}

/**
 * GitHub Git Trees API response
 */
interface GitTreeResponse {
    sha: string;
    url: string;
    tree: GitTreeItem[];
    truncated: boolean;
}

export class GitHubSkillsClient {
    private static readonly BASE_URL = 'https://api.github.com';
    private static readonly RAW_URL = 'https://raw.githubusercontent.com';
    private cache: Map<string, CacheEntry<unknown>> = new Map();

    constructor(private readonly context: vscode.ExtensionContext) {}

    /**
     * Fetch all skills from configured repositories
     * 
     * API calls: 1 per repository (using Git Trees API)
     * File content: Fetched via raw.githubusercontent.com (no API limit)
     */
    async fetchAllSkills(): Promise<{ skills: Skill[]; failures: FailedRepository[] }> {
        const repositories = readRepositoriesConfig();
        
        const allSkills: Skill[] = [];
        const failures: FailedRepository[] = [];

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: 'Fetching content...',
        }, async (progress) => {
            const results = await Promise.allSettled(
                repositories.map(async (repo) => {
                    progress.report({ message: `${repo.owner}/${repo.repo}` });
                    const discovered = await this.discoverAreas(repo.owner, repo.repo, repo.branch || 'main');
                    return this.fetchRepoContent(repo, discovered);
                })
            );

            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                if (result.status === 'fulfilled') {
                    allSkills.push(...result.value.skills);
                } else {
                    const repo = repositories[i];
                    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
                    console.error(`Failed to fetch content from ${repo.owner}/${repo.repo}:`, result.reason);
                    failures.push({ repo, error: message });
                }
            }
        });

        return { skills: allSkills, failures };
    }

    /**
     * Fetch Git Trees API response (recursive)
     * 
     * API calls: 1
     */
    private async fetchRepoTree(owner: string, repo: string, branch: string): Promise<GitTreeResponse> {
        const cacheKey = `tree:${owner}/${repo}@${branch}`;
        const cached = this.getFromCache<GitTreeResponse>(cacheKey);
        if (cached) {
            return cached;
        }

        const url = `${GitHubSkillsClient.BASE_URL}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
        const response = await this.fetchWithAuth(url);
        
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error(`Repository or branch not found: ${owner}/${repo}@${branch}`);
            }
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        this.checkRateLimit(response);
        
        const data = await response.json() as GitTreeResponse;
        
        if (data.truncated) {
            console.warn(`Tree for ${owner}/${repo} was truncated. Some skills may be missing.`);
        }
        
        this.setCache(cacheKey, data);
        return data;
    }

    /**
     * Fetch and parse SKILL.md using raw.githubusercontent.com (bypasses API rate limit)
     * 
     * API calls: 0 (uses raw content URL)
     */
    async fetchSkillMetadataRaw(repo: SkillRepository, skillName: string, skillPath: string, area: ContentArea = 'skills'): Promise<Skill | null> {
        const def = AREA_DEFINITIONS[area];
        const defFile = def.definitionFile || 'SKILL.md';
        const defFilePath = `${skillPath}/${defFile}`;
        
        try {
            const content = await this.fetchRawContent(repo.owner, repo.repo, defFilePath, repo.branch || 'main');

            let name = skillName;
            let description = 'No description available';
            let license: string | undefined;
            let compatibility: string | undefined;
            let bodyContent: string | undefined;
            let readmeFullContent: string | undefined;

            if (defFile.endsWith('.json')) {
                // Parse JSON definition files (e.g. plugin.json, hooks.json)
                try {
                    const json = JSON.parse(content);
                    name = json.name || skillName;
                    description = json.description || description;
                    license = json.license;
                } catch {
                    // JSON parse failed — use folder name as fallback
                }

                // Try to fetch README.md from the same directory for body content
                try {
                    const readmePath = `${skillPath}/README.md`;
                    readmeFullContent = await this.fetchRawContent(repo.owner, repo.repo, readmePath, repo.branch || 'main');
                    // Parse frontmatter from README if present
                    const readmeParsed = this.parseSkillMd(readmeFullContent);
                    bodyContent = readmeParsed.body || readmeFullContent;
                    // Use README frontmatter for name/description if JSON didn't provide them
                    if (name === skillName && readmeParsed.metadata.name) { name = readmeParsed.metadata.name; }
                    if (description === 'No description available' && readmeParsed.metadata.description) { description = readmeParsed.metadata.description; }
                } catch {
                    // No README.md, that's fine
                }
            } else {
                // Parse markdown frontmatter (SKILL.md, POWER.md)
                const parsed = this.parseSkillMd(content);
                name = parsed.metadata.name || skillName;
                description = parsed.metadata.description || description;
                license = parsed.metadata.license;
                compatibility = parsed.metadata.compatibility;
                bodyContent = parsed.body;
            }

            return {
                name,
                description,
                license,
                compatibility,
                source: repo,
                skillPath,
                area,
                fullContent: readmeFullContent || content,
                bodyContent,
                // For JSON-based areas, preserve the raw definition file content
                definitionContent: defFile.endsWith('.json') ? content : undefined
            };
        } catch (_error) {
            console.warn(`No ${defFile} found for ${skillName}`);
            return null;
        }
    }

    /**
     * Fetch raw file content from raw.githubusercontent.com
     * 
     * This endpoint does NOT count against GitHub API rate limits!
     */
    private async fetchRawContent(owner: string, repo: string, path: string, branch: string): Promise<string> {
        const cacheKey = `raw:${owner}/${repo}/${path}@${branch}`;
        const cached = this.getFromCache<string>(cacheKey);
        if (cached) {
            return cached;
        }

        const url = `${GitHubSkillsClient.RAW_URL}/${owner}/${repo}/${branch}/${path}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch file: ${response.status}`);
        }
        
        const content = await response.text();
        this.setCache(cacheKey, content);
        return content;
    }

    /**
     * Fetch raw file content (kept for backward compatibility)
     */
    async fetchFileContent(owner: string, repo: string, path: string, branch: string): Promise<string> {
        // Use raw.githubusercontent.com for efficiency
        return this.fetchRawContent(owner, repo, path, branch);
    }

    /**
     * Fetch all files in a skill directory for installation
     * Uses Git Trees API for efficiency
     */
    async fetchSkillFiles(skill: Skill): Promise<{ path: string; content: string }[]> {
        const { owner, repo, branch } = skill.source;
        
        // Get tree (likely cached from earlier fetch)
        const tree = await this.fetchRepoTree(owner, repo, branch);
        
        // Find all files under this skill's path
        const skillFiles = tree.tree.filter(item => 
            item.type === 'blob' && 
            item.path.startsWith(skill.skillPath + '/')
        );

        // Fetch all file contents in parallel using raw URLs
        const files = await Promise.all(
            skillFiles.map(async (item) => {
                const relativePath = item.path.substring(skill.skillPath.length + 1);
                const content = await this.fetchRawContent(owner, repo, item.path, branch);
                return { path: relativePath, content };
            })
        );

        return files;
    }

    /**
     * Parse SKILL.md content into metadata and body
     */
    private parseSkillMd(content: string): { metadata: SkillMetadata; body: string } {
        const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        
        if (!frontmatterMatch) {
            // Try to extract basic info even without frontmatter
            return {
                metadata: { name: '', description: '' },
                body: content
            };
        }

        const yamlContent = frontmatterMatch[1];
        const body = frontmatterMatch[2];
        
        const metadata = this.parseYamlFrontmatter(yamlContent);
        
        return { metadata, body };
    }

    /**
     * Simple YAML frontmatter parser
     */
    private parseYamlFrontmatter(yaml: string): SkillMetadata {
        const metadata: SkillMetadata = { name: '', description: '' };
        
        const lines = yaml.split('\n');
        let currentKey = '';
        let multilineValue = '';
        
        for (const line of lines) {
            // Check for key: value pattern
            const keyMatch = line.match(/^(\w+(?:-\w+)*):\s*(.*)$/);
            
            if (keyMatch) {
                // Save previous multiline value if any
                if (currentKey && multilineValue) {
                    this.setMetadataValue(metadata, currentKey, multilineValue.trim());
                }
                
                currentKey = keyMatch[1];
                const value = keyMatch[2].trim();
                
                if (value) {
                    this.setMetadataValue(metadata, currentKey, value);
                    currentKey = '';
                    multilineValue = '';
                } else {
                    multilineValue = '';
                }
            } else if (currentKey && line.startsWith('  ')) {
                multilineValue += line.trim() + ' ';
            }
        }
        
        // Handle last multiline value
        if (currentKey && multilineValue) {
            this.setMetadataValue(metadata, currentKey, multilineValue.trim());
        }
        
        return metadata;
    }

    private setMetadataValue(metadata: SkillMetadata, key: string, value: string): void {
        switch (key) {
            case 'name':
                // Strip surrounding quotes (single or double) from skill names
                metadata.name = value.replace(/^['"]|['"]$/g, '');
                break;
            case 'description':
                metadata.description = value;
                break;
            case 'license':
                metadata.license = value;
                break;
            case 'compatibility':
                metadata.compatibility = value;
                break;
            case 'allowed-tools':
                metadata.allowedTools = value;
                break;
        }
    }

    /**
     * Fetch with GitHub authentication if token is configured
     */
    private async fetchWithAuth(url: string, additionalHeaders?: Record<string, string>): Promise<Response> {
        const config = vscode.workspace.getConfiguration('agentOrganizer');
        const token = config.get<string>('githubToken', '');
        
        const headers: Record<string, string> = {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...additionalHeaders
        };
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        return fetch(url, { headers });
    }

    /**
     * Check and warn about rate limits
     */
    private checkRateLimit(response: Response): void {
        const remaining = response.headers.get('x-ratelimit-remaining');
        const reset = response.headers.get('x-ratelimit-reset');
        
        if (remaining && parseInt(remaining) < 10) {
            const resetDate = reset ? new Date(parseInt(reset) * 1000) : new Date();
            vscode.window.showWarningMessage(
                `GitHub API rate limit low (${remaining} remaining). Resets at ${resetDate.toLocaleTimeString()}`
            );
        }
    }

    /**
     * Get data from cache if not expired
     */
    private getFromCache<T>(key: string): T | null {
        const entry = this.cache.get(key) as CacheEntry<T> | undefined;
        if (!entry) {
            return null;
        }
        
        const config = vscode.workspace.getConfiguration('agentOrganizer');
        const timeout = config.get<number>('cacheTimeout', 3600) * 1000;
        
        if (Date.now() - entry.timestamp > timeout) {
            this.cache.delete(key);
            return null;
        }
        
        return entry.data;
    }

    /**
     * Store data in cache
     */
    private setCache<T>(key: string, data: T): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    /**
     * Discover which content areas exist in a repository by scanning the tree.
     * Returns an AreaPaths mapping each found area to its path.
     * API calls: 1 (Git Trees, recursive — reuses cached tree)
     */
    async discoverAreas(owner: string, repo: string, branch: string): Promise<AreaPaths> {
        const tree = await this.fetchRepoTree(owner, repo, branch);
        const result: AreaPaths = {};

        // Step 1: Check for top-level directories matching area names
        // This is the strongest signal — a folder named "skills", "agents", etc.
        const topLevelDirs = new Set(
            tree.tree
                .filter(item => item.type === 'tree' && !item.path.includes('/'))
                .map(item => item.path)
        );

        // Map of conventional folder names to areas
        // Areas with conventionalDir override use that; others use the area key itself
        for (const area of ALL_CONTENT_AREAS) {
            const def = AREA_DEFINITIONS[area];
            const dirName = def.conventionalDir || area;
            if (!topLevelDirs.has(dirName)) { continue; }

            // If hooksGithub was already found for this dir, skip hooksKiro (they're mutually exclusive)
            if (area === 'hooksKiro' && result['hooksGithub'] !== undefined) { continue; }

            // Verify the directory actually contains matching content
            if (def.kind === 'multiFile' && def.definitionFile) {
                const hasContent = tree.tree.some(item =>
                    item.type === 'blob' &&
                    item.path.startsWith(dirName + '/') &&
                    item.path.endsWith(`/${def.definitionFile}`)
                );
                if (hasContent) { result[area] = dirName; }
            } else if (def.kind === 'singleFile' && def.fileSuffix) {
                const hasContent = tree.tree.some(item =>
                    item.type === 'blob' &&
                    item.path.startsWith(dirName + '/') &&
                    item.path.endsWith(def.fileSuffix!)
                );
                if (hasContent) { result[area] = dirName; }
            }
        }

        // Step 2: For areas not found via conventional names, search the full tree
        // but exclude files under already-discovered area paths
        const discoveredPrefixes = Object.values(result)
            .filter(p => p !== undefined && p !== '')
            .map(p => p + '/');

        for (const area of ALL_CONTENT_AREAS) {
            if (result[area] !== undefined) { continue; } // Already found

            const def = AREA_DEFINITIONS[area];
            if (def.conventionalOnly) { continue; } // Only discoverable via conventional top-level dir name

            if (def.kind === 'multiFile' && def.definitionFile) {
                const defFiles = tree.tree.filter(item =>
                    item.type === 'blob' &&
                    item.path.endsWith(`/${def.definitionFile}`) &&
                    !discoveredPrefixes.some(p => item.path.startsWith(p))
                );
                if (defFiles.length > 0) {
                    const dirCounts = new Map<string, number>();
                    for (const item of defFiles) {
                        const skillDir = item.path.substring(0, item.path.lastIndexOf('/'));
                        const parentDir = skillDir.includes('/')
                            ? skillDir.substring(0, skillDir.lastIndexOf('/'))
                            : skillDir;
                        dirCounts.set(parentDir, (dirCounts.get(parentDir) || 0) + 1);
                    }
                    let bestDir = '';
                    let bestCount = 0;
                    for (const [dir, count] of dirCounts) {
                        if (count > bestCount) { bestDir = dir; bestCount = count; }
                    }
                    result[area] = bestDir;
                    if (bestDir) { discoveredPrefixes.push(bestDir + '/'); }
                }
            } else if (def.kind === 'singleFile' && def.fileSuffix) {
                const matchingFiles = tree.tree.filter(item =>
                    item.type === 'blob' &&
                    item.path.endsWith(def.fileSuffix!) &&
                    !discoveredPrefixes.some(p => item.path.startsWith(p))
                );
                if (matchingFiles.length > 0) {
                    const dirCounts = new Map<string, number>();
                    for (const item of matchingFiles) {
                        const parts = item.path.split('/');
                        const dir = parts.length > 1 ? parts[0] : '';
                        dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
                    }
                    let bestDir = '';
                    let bestCount = 0;
                    for (const [dir, count] of dirCounts) {
                        if (count > bestCount) { bestDir = dir; bestCount = count; }
                    }
                    result[area] = bestDir;
                    if (bestDir) { discoveredPrefixes.push(bestDir + '/'); }
                }
            }
        }

        return result;
    }

    /**
     * Fetch all content from a repository across all discovered areas.
     * Returns skills (multi-file items) and fileItems (single-file items).
     * API calls: 1 for tree + N raw content fetches (no rate limit)
     */
    async fetchRepoContent(repo: SkillRepository, areaPaths: AreaPaths): Promise<RepoContent> {
        const branch = repo.branch || 'main';
        const tree = await this.fetchRepoTree(repo.owner, repo.repo, branch);
        const paths = areaPaths;

        const skills: Skill[] = [];
        const fileItems: AreaFileItem[] = [];

        // Build exclusion prefixes: all configured area paths except the current one
        // This prevents e.g. a .prompt.md inside a plugin folder from appearing under Prompts
        const allAreaPrefixes = new Map<ContentArea, string>();
        for (const a of ALL_CONTENT_AREAS) {
            const p = paths[a];
            if (p !== undefined && p !== '') {
                allAreaPrefixes.set(a, p + '/');
            }
        }

        // Process each area that has a path configured
        for (const area of ALL_CONTENT_AREAS) {
            const areaPath = paths[area];
            if (areaPath === undefined) { continue; }

            const def = AREA_DEFINITIONS[area];

            // Exclusion prefixes: other area paths that differ from this area's path
            const currentPrefix = areaPath ? areaPath + '/' : '';
            const otherPrefixes = [...allAreaPrefixes.entries()]
                .filter(([a, prefix]) => a !== area && prefix !== currentPrefix)
                .map(([, prefix]) => prefix);

            if (def.kind === 'multiFile' && def.definitionFile) {
                const prefix = areaPath ? areaPath + '/' : '';
                const defFiles = tree.tree.filter(item =>
                    item.type === 'blob' &&
                    item.path.startsWith(prefix) &&
                    item.path.endsWith(`/${def.definitionFile}`) &&
                    !otherPrefixes.some(op => item.path.startsWith(op))
                );

                // Deduplicate: find the item root folder for each definition file.
                // The item root is determined by removing the definition file and any
                // known wrapper directories (e.g. .claude-plugin/, .github/plugin/).
                // This handles repos that use category subfolders like plugins/agents/my-plugin/.claude-plugin/plugin.json
                const seenItems = new Map<string, string>(); // itemDir → first defFile path
                for (const item of defFiles) {
                    // Strip the area prefix and definition file name to get the relative structure
                    // e.g. "plugins/agents/my-plugin/.claude-plugin/plugin.json" → "agents/my-plugin/.claude-plugin"
                    const relativePath = item.path.substring(prefix.length);
                    const segments = relativePath.split('/');
                    // Remove the definition file name (last segment)
                    segments.pop();
                    // Remove known wrapper directory segments from the end
                    while (segments.length > 0) {
                        const last = segments[segments.length - 1];
                        if (last.startsWith('.') || last === 'plugin' || last === 'hooks') {
                            segments.pop();
                        } else {
                            break;
                        }
                    }
                    // The remaining segments form the item path relative to the area
                    const itemRelative = segments.join('/');
                    const itemDir = itemRelative ? prefix + itemRelative : prefix.replace(/\/$/, '');
                    if (!seenItems.has(itemDir)) {
                        seenItems.set(itemDir, item.path);
                    }
                }

                const items = await Promise.all(
                    [...seenItems.entries()].map(async ([itemDir, defFilePath]) => {
                        const skillName = itemDir.split('/').pop() || itemDir;
                        // Use the actual definition file path's parent for metadata fetching
                        const defParentDir = defFilePath.substring(0, defFilePath.lastIndexOf('/'));
                        try {
                            const skill = await this.fetchSkillMetadataRaw(repo, skillName, defParentDir, area);
                            // Override skillPath to point to the item's root folder (not the nested def file location)
                            if (skill) {
                                skill.skillPath = itemDir;
                                // If README wasn't found at the def file location, try the item root
                                if (!skill.bodyContent && defParentDir !== itemDir) {
                                    try {
                                        const readmePath = `${itemDir}/README.md`;
                                        const readmeContent = await this.fetchRawContent(repo.owner, repo.repo, readmePath, repo.branch || 'main');
                                        const readmeParsed = this.parseSkillMd(readmeContent);
                                        skill.bodyContent = readmeParsed.body || readmeContent;
                                        skill.fullContent = readmeContent;
                                        if (skill.name === skillName && readmeParsed.metadata.name) { skill.name = readmeParsed.metadata.name; }
                                        if (skill.description === 'No description available' && readmeParsed.metadata.description) { skill.description = readmeParsed.metadata.description; }
                                    } catch { /* no README at root either */ }
                                }
                            }
                            return skill;
                        } catch (error) {
                            console.warn(`Failed to fetch ${area} at ${itemDir}:`, error);
                            return null;
                        }
                    })
                );
                skills.push(...items.filter((s): s is Skill => s !== null));

            } else if (def.kind === 'singleFile' && def.fileSuffix) {
                const prefix = areaPath ? areaPath + '/' : '';
                const matchingFiles = tree.tree.filter(item =>
                    item.type === 'blob' &&
                    (areaPath === '' ? item.path.endsWith(def.fileSuffix!) : item.path.startsWith(prefix) && item.path.endsWith(def.fileSuffix!)) &&
                    !otherPrefixes.some(op => item.path.startsWith(op))
                );

                for (const item of matchingFiles) {
                    const fileName = item.path.split('/').pop() || item.path;
                    const name = fileName.substring(0, fileName.length - def.fileSuffix!.length);

                    const relativePath = areaPath ? item.path.substring(prefix.length) : item.path;
                    const folderPath = relativePath.includes('/')
                        ? relativePath.substring(0, relativePath.lastIndexOf('/'))
                        : '';

                    fileItems.push({
                        name,
                        filePath: item.path,
                        area,
                        source: repo,
                        folderPath,
                    });
                }
            }
        }

        return { skills, fileItems };
    }

    /**
     * Fetch the default branch for a repository from the GitHub API.
     */
    async fetchDefaultBranch(owner: string, repo: string): Promise<string> {
        const cacheKey = `default-branch:${owner}/${repo}`;
        const cached = this.getFromCache<string>(cacheKey);
        if (cached) {
            return cached;
        }

        const url = `${GitHubSkillsClient.BASE_URL}/repos/${owner}/${repo}`;
        const response = await this.fetchWithAuth(url);
        if (!response.ok) {
            return 'main'; // safe fallback
        }

        const data = await response.json() as { default_branch: string };
        this.setCache(cacheKey, data.default_branch);
        return data.default_branch;
    }

    /**
     * Clear all cached data
     */
    clearCache(): void {
        this.cache.clear();
    }
}
