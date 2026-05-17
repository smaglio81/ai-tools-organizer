/**
 * GitHub implementation of RepoTransport.
 *
 * Tree listing:
 *   - fetchRootTreeEntries: one non-recursive GET of the branch root tree.
 *   - fetchSubtreeRecursive: resolves the subtree SHA from the root response,
 *     then issues a single recursive GET against that SHA.
 * File content: raw.githubusercontent.com (no API rate-limit cost).
 * Default branch: GitHub Repositories API.
 */

import * as vscode from 'vscode';
import { SkillRepository, CacheEntry } from '../types';
import { RepoTransport, RepoTreeItem } from './repoTransport';

interface GhTreeItem {
    path: string;
    type: 'blob' | 'tree';
    sha: string;
    size?: number;
    url?: string;
}

interface GhTreeResponse {
    tree: GhTreeItem[];
    truncated: boolean;
}

export class GitHubRepoTransport implements RepoTransport {
    private static readonly BASE_URL = 'https://api.github.com';
    private static readonly RAW_URL = 'https://raw.githubusercontent.com';

    constructor(private readonly cache: Map<string, CacheEntry<unknown>>) {}

    /**
     * Fetch the non-recursive root tree for a branch.
     * Result is cached; sha-keyed subtree fetches re-use the sha recorded here.
     */
    async fetchRootTreeEntries(repo: SkillRepository): Promise<RepoTreeItem[]> {
        const rootResponse = await this.fetchRootTree(repo);
        return rootResponse.tree.map(item => ({
            path: item.path,
            type: item.type as 'blob' | 'tree',
        }));
    }

    /**
     * Recursively fetch all items under `prefixPath` by resolving its tree SHA
     * from the root tree, then requesting that subtree with recursive=1.
     */
    async fetchSubtreeRecursive(repo: SkillRepository, prefixPath: string): Promise<RepoTreeItem[]> {
        const rootResponse = await this.fetchRootTree(repo);

        // Find the tree entry for this prefix at the root level
        const subtreeEntry = rootResponse.tree.find(
            item => item.type === 'tree' && item.path === prefixPath
        );
        if (!subtreeEntry) {
            return [];
        }

        const sha = subtreeEntry.sha;
        const cacheKey = `gh:subtree:${repo.owner}/${repo.repo}@${sha}`;
        const cached = this.getFromCache<GhTreeItem[]>(cacheKey);
        if (cached) {
            return this.normalizeSubtreeItems(cached, prefixPath);
        }

        const url = `${GitHubRepoTransport.BASE_URL}/repos/${repo.owner}/${repo.repo}/git/trees/${sha}?recursive=1`;
        const response = await this.fetchWithAuth(url);

        if (!response.ok) {
            throw new Error(`GitHub API error fetching subtree ${prefixPath}: ${response.status} ${response.statusText}`);
        }

        this.checkRateLimit(response);

        const data = await response.json() as GhTreeResponse;

        if (data.truncated) {
            console.warn(`Subtree ${prefixPath} in ${repo.owner}/${repo.repo} was truncated. Some content may be missing.`);
        }

        this.setCache(cacheKey, data.tree);
        return this.normalizeSubtreeItems(data.tree, prefixPath);
    }

    /**
     * Fetch (and cache) the non-recursive root tree response.
     * The root tree SHA entries are used both for root listing and to resolve subtree SHAs.
     */
    private async fetchRootTree(repo: SkillRepository): Promise<GhTreeResponse> {
        const branch = repo.branch || 'main';
        const cacheKey = `gh:root:${repo.owner}/${repo.repo}@${branch}`;
        const cached = this.getFromCache<GhTreeResponse>(cacheKey);
        if (cached) { return cached; }

        const url = `${GitHubRepoTransport.BASE_URL}/repos/${repo.owner}/${repo.repo}/git/trees/${branch}`;
        const response = await this.fetchWithAuth(url);

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error(`Repository or branch not found: ${repo.owner}/${repo.repo}@${branch}`);
            }
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        this.checkRateLimit(response);

        const data = await response.json() as GhTreeResponse;
        this.setCache(cacheKey, data);
        return data;
    }

    /** Prepend `prefix/` to each item path so callers get full repo-relative paths. */
    private normalizeSubtreeItems(items: GhTreeItem[], prefix: string): RepoTreeItem[] {
        return items.map(item => ({
            path: `${prefix}/${item.path}`,
            type: item.type as 'blob' | 'tree',
        }));
    }

    async fetchFileText(repo: SkillRepository, path: string): Promise<string> {
        const branch = repo.branch || 'main';
        const cacheKey = `gh:raw:${repo.owner}/${repo.repo}/${path}@${branch}`;
        const cached = this.getFromCache<string>(cacheKey);
        if (cached) { return cached; }

        const url = `${GitHubRepoTransport.RAW_URL}/${repo.owner}/${repo.repo}/${branch}/${path}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to fetch file: ${response.status}`);
        }

        const content = await response.text();
        this.setCache(cacheKey, content);
        return content;
    }

    async fetchDefaultBranch(repo: SkillRepository): Promise<string> {
        const cacheKey = `gh:default-branch:${repo.owner}/${repo.repo}`;
        const cached = this.getFromCache<string>(cacheKey);
        if (cached) { return cached; }

        const url = `${GitHubRepoTransport.BASE_URL}/repos/${repo.owner}/${repo.repo}`;
        const response = await this.fetchWithAuth(url);
        if (!response.ok) {
            return 'main';
        }

        const data = await response.json() as { default_branch: string };
        this.setCache(cacheKey, data.default_branch);
        return data.default_branch;
    }

    private async fetchWithAuth(url: string): Promise<Response> {
        const config = vscode.workspace.getConfiguration('AIToolsOrganizer');
        const token = config.get<string>('githubToken', '');

        const headers: Record<string, string> = {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        return fetch(url, { headers });
    }

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

    private getFromCache<T>(key: string): T | null {
        const entry = this.cache.get(key) as CacheEntry<T> | undefined;
        if (!entry) { return null; }

        const config = vscode.workspace.getConfiguration('AIToolsOrganizer');
        const timeout = config.get<number>('cacheTimeout', 3600) * 1000;

        if (Date.now() - entry.timestamp > timeout) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    private setCache<T>(key: string, data: T): void {
        this.cache.set(key, { data, timestamp: Date.now() });
    }
}
