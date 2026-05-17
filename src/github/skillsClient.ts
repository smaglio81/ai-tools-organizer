/**
 * Remote repository client for fetching AI Tools Organizer content.
 *
 * Supports both GitHub and Azure DevOps repositories via a transport layer:
 *   - GitHubRepoTransport  — GitHub Git Trees API + raw.githubusercontent.com
 *   - AzureDevOpsRepoTransport — ADO Git Items API
 *
 * Discovery and YAML/JSON parsing are shared regardless of hosting provider.
 *
 * Tree fetching strategy
 * ──────────────────────
 * Rather than pulling a full recursive tree for the entire repository, the client
 * performs scoped fetching:
 *
 *   1. Fetch only the root-level entries (one API call, non-recursive).
 *   2. Intersect those root entries against an allowlist of "interesting" top-level
 *      directories: dot-tooling roots (.cursor, .claude, .cursor-plugin, .github) plus the
 *      conventional directory name for every recognised content area (skills, agents, …).
 *   3. For each matching root directory, fetch its subtree recursively (one API call each).
 *   4. If a .cursor-plugin/marketplace.json exists, parse it and also fetch the subtree
 *      of each declared plugin directory.
 *   5. Merge and deduplicate all subtree results for downstream discovery and content logic.
 */

import * as vscode from 'vscode';
import { Skill, SkillRepository, SkillMetadata, CacheEntry, FailedRepository, readRepositoriesConfig, ContentArea, ALL_CONTENT_AREAS, AREA_DEFINITIONS, AreaFileItem, RepoContent, AreaPaths, isYamlBlockScalar, stripYamlQuotes, collectBlockScalarValue, getAreaFileSuffixes, deriveItemName, isAdoRepository, formatRepoLabel } from '../types';
import { RepoTransport, RepoTreeItem } from '../repos/repoTransport';
import { GitHubRepoTransport } from '../repos/githubRepoTransport';
import { AzureDevOpsRepoTransport, notifyAzureDevOpsPatMissingIfNeeded } from '../repos/azureDevOpsRepoTransport';

/**
 * Fixed dot-tooling root directories that are always included in the interesting-prefix
 * allowlist when they appear at the repo root.
 */
const DOT_TOOL_DIRS: ReadonlySet<string> = new Set(['.cursor', '.claude', '.cursor-plugin', '.github', '.kiro']);

/**
 * Derive the set of conventional top-level directory names from AREA_DEFINITIONS.
 * Used as additional candidates beyond the dot-tooling roots.
 */
function buildConventionalDirs(): ReadonlySet<string> {
    const dirs = new Set<string>();
    for (const area of ALL_CONTENT_AREAS) {
        const def = AREA_DEFINITIONS[area];
        dirs.add(def.conventionalDir || area);
    }
    return dirs;
}

const CONVENTIONAL_DIRS: ReadonlySet<string> = buildConventionalDirs();

export class GitHubSkillsClient {
    private cache: Map<string, CacheEntry<unknown>> = new Map();
    private ghTransport: GitHubRepoTransport;
    private adoTransport: AzureDevOpsRepoTransport;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.ghTransport = new GitHubRepoTransport(this.cache);
        this.adoTransport = new AzureDevOpsRepoTransport(this.cache);
    }

    /**
     * Normalize paths declared in marketplace.json (strip leading `./`, trim slashes,
     * accept backslashes) so subtree prefixes and Git/ADO file paths are valid.
     */
    private normalizeRepoRelativePath(raw: string): string {
        let s = raw.trim().replace(/\\/g, '/');
        while (s.startsWith('./')) {
            s = s.slice(2);
        }
        while (s.startsWith('/')) {
            s = s.slice(1);
        }
        return s.replace(/\/+/g, '/').replace(/\/+$/, '');
    }

    /** Select the correct transport for a repository. */
    private transport(repo: SkillRepository): RepoTransport {
        return isAdoRepository(repo) ? this.adoTransport : this.ghTransport;
    }

    /**
     * Fetch all skills from configured repositories.
     *
     * API calls per repo: 1 root listing + 1 per interesting subtree
     * File content: fetched individually on demand (no rate-limit cost on GitHub)
     */
    async fetchAllSkills(): Promise<{ skills: Skill[]; failures: FailedRepository[] }> {
        const repositories = readRepositoriesConfig();
        
        const allSkills: Skill[] = [];
        const failures: FailedRepository[] = [];

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: 'Fetching content...',
        }, async (progress) => {
            notifyAzureDevOpsPatMissingIfNeeded(repositories);

            const results = await Promise.allSettled(
                repositories.map(async (repo) => {
                    progress.report({ message: formatRepoLabel(repo) });
                    const discovered = await this.discoverAreas(repo);
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
                    console.error(`Failed to fetch content from ${formatRepoLabel(repo)}:`, result.reason);
                    failures.push({ repo, error: message });
                }
            }
        });

        return { skills: allSkills, failures };
    }

    /**
     * Build the merged tree of all interesting subtrees for a repository.
     *
     * Steps:
     *  1. Fetch root entries (one non-recursive API call).
     *  2. Intersect root directory names against the allowlist (dot-tool dirs + conventional dirs).
     *  3. Check if .cursor-plugin/marketplace.json is reachable; if so, parse it and add each
     *     declared plugin directory to the prefix set.
     *  4. Fetch each interesting subtree recursively (one API call per prefix).
     *  5. Merge results, deduplicating by path (first writer wins).
     */
    private async fetchMergedInterestingTree(repo: SkillRepository): Promise<RepoTreeItem[]> {
        const transport = this.transport(repo);

        // Step 1: non-recursive root listing
        const rootEntries = await transport.fetchRootTreeEntries(repo);

        // Step 2: build the set of interesting prefixes from root dirs
        const prefixSet = new Set<string>();
        for (const entry of rootEntries) {
            if (entry.type !== 'tree') { continue; }
            const name = entry.path;
            if (DOT_TOOL_DIRS.has(name) || CONVENTIONAL_DIRS.has(name)) {
                prefixSet.add(name);
            }
        }

        // Step 3: marketplace augmentation — probe .cursor-plugin/marketplace.json
        // and collect plugin directories declared there.
        const marketplacePluginDirs = await this.collectMarketplacePluginDirs(repo);
        for (const dir of marketplacePluginDirs) {
            if (!dir.includes('..')) {
                prefixSet.add(dir.split('/')[0]); // add the top-level segment
            }
        }

        // Step 4: fetch each interesting subtree
        const merged = new Map<string, RepoTreeItem>();

        // Include root-level blobs (e.g. a marketplace.json at .cursor-plugin/ root)
        for (const entry of rootEntries) {
            if (!merged.has(entry.path)) {
                merged.set(entry.path, entry);
            }
        }

        await Promise.all(
            [...prefixSet].map(async (prefix) => {
                try {
                    const items = await transport.fetchSubtreeRecursive(repo, prefix);
                    for (const item of items) {
                        if (!merged.has(item.path)) {
                            merged.set(item.path, item);
                        }
                    }
                } catch (err) {
                    console.warn(`Failed to fetch subtree "${prefix}" in ${formatRepoLabel(repo)}:`, err);
                }
            })
        );

        return [...merged.values()];
    }

    /**
     * Attempt to read .cursor-plugin/marketplace.json and return the list of plugin
     * directory paths declared in it (applying pluginRoot if present).
     * Returns an empty array when the file does not exist or is invalid.
     */
    private async collectMarketplacePluginDirs(repo: SkillRepository): Promise<string[]> {
        let raw: string;
        try {
            raw = await this.transport(repo).fetchFileText(repo, '.cursor-plugin/marketplace.json');
        } catch {
            return [];
        }

        let manifest: unknown;
        try {
            manifest = JSON.parse(raw);
        } catch {
            return [];
        }

        if (!manifest || typeof manifest !== 'object') { return []; }
        const m = manifest as Record<string, unknown>;
        const pluginsArray = m['plugins'];
        if (!Array.isArray(pluginsArray)) { return []; }

        const pluginRoot = (m['metadata'] as Record<string, unknown> | undefined)?.['pluginRoot'];
        const globalPrefix = typeof pluginRoot === 'string' && pluginRoot
            ? pluginRoot.replace(/\/+$/, '')
            : '';

        const dirs: string[] = [];
        for (const entry of pluginsArray) {
            if (!entry || typeof entry !== 'object') { continue; }
            const e = entry as Record<string, unknown>;
            const rawSource = typeof e['source'] === 'string'
                ? e['source']
                : (e['source'] && typeof e['source'] === 'object' && typeof (e['source'] as Record<string, unknown>)['path'] === 'string'
                    ? (e['source'] as Record<string, unknown>)['path'] as string
                    : '');
            if (!rawSource || rawSource.includes('..')) { continue; }
            const combined = globalPrefix ? `${globalPrefix}/${rawSource}` : rawSource;
            const pluginDir = this.normalizeRepoRelativePath(combined);
            if (!pluginDir || pluginDir.includes('..')) { continue; }
            dirs.push(pluginDir);
        }
        return dirs;
    }

    /**
     * Fetch and parse a definition file (SKILL.md, plugin.json, etc.) for an item.
     */
    async fetchSkillMetadataRaw(repo: SkillRepository, skillName: string, skillPath: string, area: ContentArea = 'skills'): Promise<Skill | null> {
        const def = AREA_DEFINITIONS[area];
        const defFile = def.definitionFile || 'SKILL.md';
        const defFilePath = skillPath ? `${skillPath}/${defFile}` : defFile;

        try {
            const content = await this.fetchRawContent(repo, defFilePath);

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
                    readmeFullContent = await this.fetchRawContent(repo, readmePath);
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
     * Fetch raw file content via the appropriate transport.
     */
    private async fetchRawContent(repo: SkillRepository, path: string): Promise<string> {
        return this.transport(repo).fetchFileText(repo, path);
    }

    /**
     * Fetch raw file content (kept for backward compatibility with external callers).
     */
    async fetchFileContent(owner: string, repoName: string, path: string, branch: string): Promise<string> {
        const repo: SkillRepository = { owner, repo: repoName, branch };
        return this.fetchRawContent(repo, path);
    }

    /**
     * Fetch all files in a skill directory for installation.
     * Uses a scoped subtree fetch under skill.skillPath rather than a full repo tree.
     */
    async fetchSkillFiles(skill: Skill): Promise<{ path: string; content: string }[]> {
        const transport = this.transport(skill.source);

        // Determine the top-level prefix from the skill path (first path segment)
        const topLevelPrefix = skill.skillPath.split('/')[0];
        let subtreeItems: RepoTreeItem[];

        // For items rooted at the very top of the repo (no subdirectory), fall back to
        // the merged tree so we can still enumerate files.
        if (!topLevelPrefix || topLevelPrefix === skill.skillPath) {
            subtreeItems = await this.fetchMergedInterestingTree(skill.source);
        } else {
            subtreeItems = await transport.fetchSubtreeRecursive(skill.source, topLevelPrefix);
        }

        // Filter to files under this skill's path
        const skillPrefix = skill.skillPath ? skill.skillPath + '/' : '';
        const skillFiles = subtreeItems.filter(item =>
            item.type === 'blob' &&
            (skillPrefix ? item.path.startsWith(skillPrefix) : true)
        );

        // Fetch all file contents in parallel
        const files = await Promise.all(
            skillFiles.map(async (item) => {
                const relativePath = skillPrefix ? item.path.substring(skillPrefix.length) : item.path;
                const content = await this.fetchRawContent(skill.source, item.path);
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
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const keyMatch = line.match(/^(\w+(?:-\w+)*):\s*(.*)$/);
            
            if (keyMatch) {
                if (currentKey && multilineValue) {
                    this.setMetadataValue(metadata, currentKey, multilineValue.trim());
                }
                
                currentKey = keyMatch[1];
                const value = keyMatch[2].trim();
                
                if (isYamlBlockScalar(value)) {
                    const collected = collectBlockScalarValue(lines, i, value);
                    this.setMetadataValue(metadata, currentKey, collected);
                    currentKey = '';
                    multilineValue = '';
                } else if (value) {
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
        
        if (currentKey && multilineValue) {
            this.setMetadataValue(metadata, currentKey, multilineValue.trim());
        }
        
        return metadata;
    }

    private setMetadataValue(metadata: SkillMetadata, key: string, value: string): void {
        switch (key) {
            case 'name':
                metadata.name = stripYamlQuotes(value);
                break;
            case 'description':
                metadata.description = stripYamlQuotes(value);
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
     * Discover which content areas exist in a repository by scanning the scoped tree.
     * Returns an AreaPaths mapping each found area to its path.
     *
     * API calls: 1 root + 1 per interesting subtree (results cached per session)
     */
    async discoverAreas(repo: SkillRepository): Promise<AreaPaths> {
        const tree = await this.fetchMergedInterestingTree(repo);
        const result: AreaPaths = {};

        // Step 1: Check for top-level directories matching conventional area names.
        // These appear in the merged tree because they were selected as interesting prefixes.
        const topLevelDirs = new Set(
            tree
                .filter(item => item.type === 'tree' && !item.path.includes('/'))
                .map(item => item.path)
        );

        for (const area of ALL_CONTENT_AREAS) {
            const def = AREA_DEFINITIONS[area];
            const dirName = def.conventionalDir || area;
            if (!topLevelDirs.has(dirName)) { continue; }

            // hooksGithub and hooksKiro share the same directory — only one wins
            if (area === 'hooksKiro' && result['hooksGithub'] !== undefined) { continue; }

            if (def.kind === 'multiFile' && def.definitionFile) {
                let hasContent = tree.some(item =>
                    item.type === 'blob' &&
                    item.path.startsWith(dirName + '/') &&
                    item.path.endsWith(`/${def.definitionFile}`)
                );
                if (!hasContent) {
                    hasContent = (def.alternateDefinitionFiles ?? []).some(alt =>
                        tree.some(item =>
                            item.type === 'blob' &&
                            item.path.startsWith(dirName + '/') &&
                            item.path.endsWith(`/${alt}`)
                        )
                    );
                }
                if (hasContent) { result[area] = dirName; }
            } else if (def.kind === 'singleFile') {
                const suffixes = getAreaFileSuffixes(def);
                const hasContent = tree.some(item =>
                    item.type === 'blob' &&
                    item.path.startsWith(dirName + '/') &&
                    suffixes.some(s => item.path.endsWith(s))
                );
                if (hasContent) { result[area] = dirName; }
            }
        }

        // GitHub-hosted agents: .github/agents/* when there is no top-level agents/ directory.
        // (agents are conventionalOnly so the generic single-file fallback below is skipped)
        if (result['agents'] === undefined) {
            const agentDef = AREA_DEFINITIONS['agents'];
            const suffixes = getAreaFileSuffixes(agentDef);
            const hasGithubAgents = tree.some(item =>
                item.type === 'blob' &&
                item.path.startsWith('.github/agents/') &&
                suffixes.some(s => item.path.endsWith(s))
            );
            if (hasGithubAgents) {
                result['agents'] = '.github';
            }
        }

        // Step 2: For areas not yet found, search the merged subtree paths.
        // Conventional-only areas are skipped (hooksGithub / hooksKiro).
        const discoveredPrefixes = Object.values(result)
            .filter(p => p !== undefined && p !== '')
            .map(p => p + '/');

        for (const area of ALL_CONTENT_AREAS) {
            if (result[area] !== undefined) { continue; }

            const def = AREA_DEFINITIONS[area];
            if (def.conventionalOnly) { continue; }

            if (def.kind === 'multiFile' && def.definitionFile) {
                if (area === 'plugins') {
                    const hasMarketplace = tree.some(
                        item => item.type === 'blob' && item.path === '.cursor-plugin/marketplace.json'
                    );
                    // Marketplace repos list plugins by manifest; do not treat sibling plugin folders
                    // as the plugins area root (Step 3 assigns '.cursor-plugin/marketplace').
                    if (hasMarketplace) { continue; }
                }
                const defFileSuffixes = [def.definitionFile, ...(def.alternateDefinitionFiles ?? [])];
                const defFiles = tree.filter(item =>
                    item.type === 'blob' &&
                    defFileSuffixes.some(d => item.path.endsWith(`/${d}`) || item.path === d) &&
                    !discoveredPrefixes.some(p => item.path.startsWith(p))
                );
                if (defFiles.length > 0) {
                    const dirCounts = new Map<string, number>();
                    for (const item of defFiles) {
                        const itemRoot = this.resolvePluginRootFromDefPath(item.path);
                        const parentDir = itemRoot.includes('/')
                            ? itemRoot.substring(0, itemRoot.lastIndexOf('/'))
                            : '';
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
            } else if (def.kind === 'singleFile') {
                const suffixes = getAreaFileSuffixes(def);
                const matchingFiles = tree.filter(item =>
                    item.type === 'blob' &&
                    suffixes.some(s => item.path.endsWith(s)) &&
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

        // Step 3: Cursor marketplace manifest overrides a conventional plugins/ tree
        // (same repo may list marketplace entries under pluginRoot while also having plugins/).
        const hasMarketplace = tree.some(
            item => item.type === 'blob' && item.path === '.cursor-plugin/marketplace.json'
        );
        if (hasMarketplace) {
            result['plugins'] = '.cursor-plugin/marketplace';
        }

        return result;
    }

    /**
     * Given a definition file blob path, resolve the plugin root directory by removing
     * the definition filename and any trailing wrapper directory segments
     * (e.g. `.cursor-plugin`, `.claude-plugin`, `plugin`, `hooks`).
     *
     * Examples:
     *   "my-plugin/.cursor-plugin/plugin.json" → "my-plugin"
     *   ".cursor-plugin/plugin.json"            → ""  (repo root)
     *   "plugins/my-plugin/plugin.json"         → "plugins/my-plugin"
     */
    private resolvePluginRootFromDefPath(blobPath: string): string {
        const segments = blobPath.split('/');
        segments.pop();
        while (segments.length > 0) {
            const last = segments[segments.length - 1];
            if (last.startsWith('.') || last === 'plugin' || last === 'hooks') {
                segments.pop();
            } else {
                break;
            }
        }
        return segments.join('/');
    }

    /**
     * Fetch all content from a repository across all discovered areas.
     * Returns skills (multi-file items) and fileItems (single-file items).
     *
     * API calls: scoped subtrees already fetched and cached by discoverAreas;
     * additional per-file fetches for definition files (no API rate-limit cost on GitHub).
     */
    async fetchRepoContent(repo: SkillRepository, areaPaths: AreaPaths): Promise<RepoContent> {
        const tree = await this.fetchMergedInterestingTree(repo);
        const paths = areaPaths;

        const skills: Skill[] = [];
        const fileItems: AreaFileItem[] = [];

        // Build exclusion prefixes: all configured area paths except the current one.
        // Prevents e.g. a .prompt.md inside a plugin folder from appearing under Prompts.
        const allAreaPrefixes = new Map<ContentArea, string>();
        for (const a of ALL_CONTENT_AREAS) {
            const p = paths[a];
            if (p !== undefined && p !== '') {
                allAreaPrefixes.set(a, p + '/');
            }
        }

        for (const area of ALL_CONTENT_AREAS) {
            const areaPath = paths[area];
            if (areaPath === undefined) { continue; }

            const def = AREA_DEFINITIONS[area];

            const currentPrefix = areaPath ? areaPath + '/' : '';
            const otherPrefixes = [...allAreaPrefixes.entries()]
                .filter(([a, prefix]) => a !== area && prefix !== currentPrefix)
                .map(([, prefix]) => prefix);

            if (def.kind === 'multiFile' && def.definitionFile) {
                if (areaPath === '.cursor-plugin/marketplace') {
                    const marketplaceSkills = await this.fetchCursorMarketplacePlugins(repo, tree, otherPrefixes);
                    skills.push(...marketplaceSkills);
                    continue;
                }

                const prefix = areaPath ? areaPath + '/' : '';
                const defCandidates = [def.definitionFile, ...(def.alternateDefinitionFiles ?? [])];
                const defFiles = tree.filter(item =>
                    item.type === 'blob' &&
                    item.path.startsWith(prefix) &&
                    defCandidates.some(d => item.path.endsWith(`/${d}`) || (prefix && item.path === `${prefix}${d}`)) &&
                    !otherPrefixes.some(op => item.path.startsWith(op))
                );

                const seenItems = new Map<string, string>(); // itemDir → first defFile path
                for (const item of defFiles) {
                    const itemRoot = this.resolvePluginRootFromDefPath(item.path);
                    const itemDir = itemRoot || (prefix ? prefix.replace(/\/$/, '') : '');
                    if (!seenItems.has(itemDir)) {
                        seenItems.set(itemDir, item.path);
                    }
                }

                const items = await Promise.all(
                    [...seenItems.entries()].map(async ([itemDir, defFilePath]) => {
                        const skillName = itemDir.split('/').pop() || itemDir;
                        const defParentDir = defFilePath.substring(0, defFilePath.lastIndexOf('/'));
                        try {
                            const skill = await this.fetchSkillMetadataRaw(repo, skillName, defParentDir, area);
                            if (skill) {
                                skill.skillPath = itemDir;
                                if (!skill.bodyContent && defParentDir !== itemDir) {
                                    try {
                                        const readmePath = itemDir ? `${itemDir}/README.md` : 'README.md';
                                        const readmeContent = await this.fetchRawContent(repo, readmePath);
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

            } else if (def.kind === 'singleFile') {
                const suffixes = getAreaFileSuffixes(def);
                const prefix = areaPath ? areaPath + '/' : '';
                const matchingFiles = tree.filter(item =>
                    item.type === 'blob' &&
                    (areaPath === ''
                        ? suffixes.some(s => item.path.endsWith(s))
                        : item.path.startsWith(prefix) && suffixes.some(s => item.path.endsWith(s))
                    ) &&
                    !otherPrefixes.some(op => item.path.startsWith(op))
                );

                const seenNames = new Set<string>();
                for (const item of matchingFiles) {
                    const fileName = item.path.split('/').pop() || item.path;
                    const name = deriveItemName(fileName, def);
                    if (seenNames.has(name)) { continue; }
                    seenNames.add(name);

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
     * Expand a Cursor marketplace manifest (.cursor-plugin/marketplace.json) into Skill entries.
     * Each entry in the manifest's `plugins` array becomes one plugin Skill.
     * Per-plugin .cursor-plugin/plugin.json manifests are merged in (per-plugin wins on
     * name/description if provided).
     *
     * The manifest has already been fetched during tree building; treeItems is used to
     * verify plugin manifest existence. If a manifest is listed in marketplace.json but
     * its .cursor-plugin/plugin.json is absent from the tree, the fetch is attempted anyway
     * and skipped only on failure—this avoids requiring a full tree for verification.
     *
     * @param repo Source repository
     * @param treeItems Merged interesting tree (used for existence hints and exclusion checks)
     * @param otherPrefixes Prefixes already claimed by other areas (exclusion list)
     */
    private async fetchCursorMarketplacePlugins(
        repo: SkillRepository,
        treeItems: RepoTreeItem[],
        otherPrefixes: string[]
    ): Promise<Skill[]> {
        let marketplaceJson: unknown;
        try {
            const raw = await this.fetchRawContent(repo, '.cursor-plugin/marketplace.json');
            marketplaceJson = JSON.parse(raw);
        } catch {
            return [];
        }

        if (!marketplaceJson || typeof marketplaceJson !== 'object') { return []; }
        const manifest = marketplaceJson as Record<string, unknown>;
        const pluginsArray = manifest['plugins'];
        if (!Array.isArray(pluginsArray)) { return []; }

        const pluginRoot = (manifest['metadata'] as Record<string, unknown> | undefined)?.['pluginRoot'];
        const globalPrefix = typeof pluginRoot === 'string' && pluginRoot ? pluginRoot.replace(/\/+$/, '') : '';

        const skills: Skill[] = [];

        for (const entry of pluginsArray) {
            if (!entry || typeof entry !== 'object') { continue; }
            const e = entry as Record<string, unknown>;

            const entryName = typeof e['name'] === 'string' ? e['name'] : '';
            const entryDesc = typeof e['description'] === 'string' ? e['description'] : '';

            const rawSource = typeof e['source'] === 'string'
                ? e['source']
                : (e['source'] && typeof e['source'] === 'object' && typeof (e['source'] as Record<string, unknown>)['path'] === 'string'
                    ? (e['source'] as Record<string, unknown>)['path'] as string
                    : '');
            if (!rawSource || rawSource.includes('..')) { continue; }
            const combined = globalPrefix ? `${globalPrefix}/${rawSource}` : rawSource;
            const pluginDir = this.normalizeRepoRelativePath(combined);
            if (!pluginDir || pluginDir.includes('..')) { continue; }

            if (otherPrefixes.some(p => pluginDir.startsWith(p))) { continue; }

            const manifestPath = `${pluginDir}/.cursor-plugin/plugin.json`;

            // Prefer the tree hint for a fast existence check; fall back to attempting
            // the fetch so we don't require the plugin directory to be in the interesting
            // subtrees already fetched.
            const inTree = treeItems.some(i => i.type === 'blob' && i.path === manifestPath);

            let name = entryName || pluginDir.split('/').pop() || pluginDir;
            let description = entryDesc;
            let bodyContent: string | undefined;
            let fullContent: string | undefined;

            try {
                const perPluginRaw = await this.fetchRawContent(repo, manifestPath);
                const perPlugin = JSON.parse(perPluginRaw) as Record<string, unknown>;
                if (typeof perPlugin['name'] === 'string' && perPlugin['name']) { name = perPlugin['name']; }
                if (typeof perPlugin['description'] === 'string' && perPlugin['description']) { description = perPlugin['description']; }
                fullContent = perPluginRaw;
            } catch {
                // If not found in tree and fetch failed, skip this plugin
                if (!inTree) { continue; }
            }

            try {
                const readmeRaw = await this.fetchRawContent(repo, `${pluginDir}/README.md`);
                const parsed = this.parseSkillMd(readmeRaw);
                bodyContent = parsed.body || readmeRaw;
                if (!fullContent) { fullContent = readmeRaw; }
            } catch { /* no README */ }

            skills.push({
                name,
                description: description || 'No description available',
                source: repo,
                skillPath: pluginDir,
                area: 'plugins',
                fullContent,
                bodyContent,
                definitionContent: fullContent,
            });
        }

        return skills;
    }

    /**
     * Fetch the default branch for a repository via the appropriate transport.
     */
    async fetchDefaultBranch(repo: SkillRepository): Promise<string> {
        return this.transport(repo).fetchDefaultBranch(repo);
    }

    /**
     * Clear all cached data
     */
    clearCache(): void {
        this.cache.clear();
    }
}
