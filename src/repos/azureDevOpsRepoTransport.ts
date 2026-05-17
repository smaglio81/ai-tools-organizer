/**
 * Azure DevOps implementation of RepoTransport.
 *
 * Tree listing:
 *   - fetchRootTreeEntries: Items API with recursionLevel=OneLevel, scopePath=/.
 *   - fetchSubtreeRecursive: Items API with recursionLevel=Full, scopePath=/{prefix}.
 * File content : Git Items API with download=true.
 * Default branch: Git Repositories API (strips "refs/heads/" prefix).
 *
 * Auth: HTTP Basic with empty username + PAT from AIToolsOrganizer.azureDevOpsPat,
 * or if unset, from the AZURE_DEVOPS_EXT_PAT environment variable.
 * For public projects PAT may be omitted, but many org-level projects require it.
 */

import * as vscode from 'vscode';
import { SkillRepository, CacheEntry, isAdoRepository } from '../types';
import { RepoTransport, RepoTreeItem } from './repoTransport';

interface AdoItemEntry {
    path: string;
    isFolder: boolean;
}

interface AdoItemsResponse {
    value: AdoItemEntry[];
    count: number;
}

interface AdoRepoInfo {
    defaultBranch: string;
}

const ADO_API_VERSION = '7.1';

/**
 * PAT from `AIToolsOrganizer.azureDevOpsPat`, else `AZURE_DEVOPS_EXT_PAT` (trimmed).
 * Exported for proactive checks before batch ADO fetches.
 */
export function getResolvedAzureDevOpsPat(): string {
    const config = vscode.workspace.getConfiguration('AIToolsOrganizer');
    const fromSettings = (config.get<string>('azureDevOpsPat', '') || '').trim();
    if (fromSettings) {
        return fromSettings;
    }
    return (process.env.AZURE_DEVOPS_EXT_PAT || '').trim();
}

/**
 * When any configured repo is Azure DevOps and no PAT is available, show one actionable error.
 * (Still allows fetch to proceed for anonymously readable projects.)
 * Only shown once per session to avoid repeated popups on refresh.
 */
let patMissingNotified = false;
export function notifyAzureDevOpsPatMissingIfNeeded(repositories: SkillRepository[]): void {
    if (patMissingNotified || !repositories.length || !repositories.some(r => isAdoRepository(r)) || getResolvedAzureDevOpsPat()) {
        return;
    }
    patMissingNotified = true;
    void vscode.window.showErrorMessage(
        'Azure DevOps marketplace sources need a Personal Access Token, but none is configured. ' +
        'Set AIToolsOrganizer.azureDevOpsPat in User Settings (PATs are stored with application scope), ' +
        'or set the AZURE_DEVOPS_EXT_PAT environment variable and fully restart Cursor so the host picks it up. ' +
        'In Azure DevOps, create a PAT with Code (read) (and access to the organization that hosts the repo).',
        'Open PAT setting'
    ).then(choice => {
        if (choice === 'Open PAT setting') {
            void vscode.commands.executeCommand('workbench.action.openSettings', 'AIToolsOrganizer.azureDevOpsPat');
        }
    });
}

export class AzureDevOpsRepoTransport implements RepoTransport {
    private authErrorShown = new Set<string>();
    constructor(private readonly cache: Map<string, CacheEntry<unknown>>) {}

    /** Show auth error once per repo per session. */
    private showAuthError(repo: SkillRepository, status: number): void {
        if (!getResolvedAzureDevOpsPat()) { return; }
        const repoKey = `${repo.owner}/${repo.project}/${repo.repo}`;
        if (this.authErrorShown.has(repoKey)) { return; }
        this.authErrorShown.add(repoKey);
        vscode.window.showErrorMessage(
            `Azure DevOps authentication failed for ${repoKey} (${status}). ` +
            'Verify your PAT has Code (read) scope, or try a new token in AIToolsOrganizer.azureDevOpsPat / AZURE_DEVOPS_EXT_PAT.'
        );
    }

    /**
     * Fetch only the immediate children of the repository root (one level deep).
     */
    async fetchRootTreeEntries(repo: SkillRepository): Promise<RepoTreeItem[]> {
        const branch = repo.branch || 'main';
        const cacheKey = `ado:root:${repo.owner}/${repo.project}/${repo.repo}@${branch}`;
        const cached = this.getFromCache<AdoItemEntry[]>(cacheKey);
        if (cached) { return this.normalizeItems(cached, ''); }

        const base = this.baseUrl(repo);
        const params = new URLSearchParams({
            'scopePath': '/',
            'recursionLevel': 'OneLevel',
            'versionDescriptor.version': branch,
            'versionDescriptor.versionType': 'branch',
            'api-version': ADO_API_VERSION,
        });
        const url = `${base}/_apis/git/repositories/${encodeURIComponent(repo.repo)}/items?${params}`;

        const response = await this.fetchWithAuth(url);

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                this.showAuthError(repo, response.status);
            }
            if (response.status === 404) {
                throw new Error(`Azure DevOps repository or branch not found: ${repo.owner}/${repo.project}/${repo.repo}@${branch}`);
            }
            throw new Error(`Azure DevOps API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as AdoItemsResponse;
        this.setCache(cacheKey, data.value);
        return this.normalizeItems(data.value, '');
    }

    /**
     * Recursively fetch all items under `prefixPath`.
     */
    async fetchSubtreeRecursive(repo: SkillRepository, prefixPath: string): Promise<RepoTreeItem[]> {
        const branch = repo.branch || 'main';
        const cacheKey = `ado:subtree:${repo.owner}/${repo.project}/${repo.repo}/${prefixPath}@${branch}`;
        const cached = this.getFromCache<AdoItemEntry[]>(cacheKey);
        if (cached) { return this.normalizeItems(cached, prefixPath); }

        const base = this.baseUrl(repo);
        const scopePath = prefixPath.startsWith('/') ? prefixPath : `/${prefixPath}`;
        const params = new URLSearchParams({
            'scopePath': scopePath,
            'recursionLevel': 'Full',
            'versionDescriptor.version': branch,
            'versionDescriptor.versionType': 'branch',
            'api-version': ADO_API_VERSION,
        });
        const url = `${base}/_apis/git/repositories/${encodeURIComponent(repo.repo)}/items?${params}`;

        const response = await this.fetchWithAuth(url);

        if (!response.ok) {
            if (response.status === 404) {
                // Subtree doesn't exist — not an error, return empty
                return [];
            }
            if (response.status === 401 || response.status === 403) {
                this.showAuthError(repo, response.status);
            }
            throw new Error(`Azure DevOps API error fetching subtree ${prefixPath}: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as AdoItemsResponse;
        this.setCache(cacheKey, data.value);
        return this.normalizeItems(data.value, prefixPath);
    }

    /**
     * Normalise ADO item entries to the common RepoTreeItem shape:
     * - Strip the mandatory leading `/` from ADO paths.
     * - Map isFolder to type.
     * - Skip the root/scope entry itself (path matches scopePath exactly).
     */
    private normalizeItems(items: AdoItemEntry[], scopePrefix: string): RepoTreeItem[] {
        const skipPath = scopePrefix ? `/${scopePrefix}` : '/';
        return items
            .filter(item => item.path !== '/' && item.path !== skipPath)
            .map(item => ({
                path: item.path.startsWith('/') ? item.path.slice(1) : item.path,
                type: item.isFolder ? 'tree' as const : 'blob' as const,
            }));
    }

    async fetchFileText(repo: SkillRepository, path: string): Promise<string> {
        const branch = repo.branch || 'main';
        const cacheKey = `ado:file:${repo.owner}/${repo.project}/${repo.repo}/${path}@${branch}`;
        const cached = this.getFromCache<string>(cacheKey);
        if (cached) { return cached; }

        const base = this.baseUrl(repo);
        const filePath = path.startsWith('/') ? path : `/${path}`;
        const params = new URLSearchParams({
            'path': filePath,
            'versionDescriptor.version': branch,
            'versionDescriptor.versionType': 'branch',
            'download': 'true',
            'api-version': ADO_API_VERSION,
        });
        const url = `${base}/_apis/git/repositories/${encodeURIComponent(repo.repo)}/items?${params}`;

        // Use text/plain Accept to get raw file content — application/json would cause
        // ADO to return JSON metadata even when download=true is set.
        const response = await this.fetchWithAuth(url, 'text/plain');

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                this.showAuthError(repo, response.status);
            }
            throw new Error(`Failed to fetch file from Azure DevOps: ${response.status}`);
        }

        const content = await response.text();
        this.setCache(cacheKey, content);
        return content;
    }

    async fetchDefaultBranch(repo: SkillRepository): Promise<string> {
        const cacheKey = `ado:default-branch:${repo.owner}/${repo.project}/${repo.repo}`;
        const cached = this.getFromCache<string>(cacheKey);
        if (cached) { return cached; }

        const base = this.baseUrl(repo);
        const url = `${base}/_apis/git/repositories/${encodeURIComponent(repo.repo)}?api-version=${ADO_API_VERSION}`;

        const response = await this.fetchWithAuth(url);
        if (!response.ok) {
            return 'main';
        }

        const data = await response.json() as AdoRepoInfo;
        // ADO returns "refs/heads/main" — strip the prefix
        const branch = (data.defaultBranch || 'refs/heads/main').replace(/^refs\/heads\//, '');
        this.setCache(cacheKey, branch);
        return branch;
    }

    private baseUrl(repo: SkillRepository): string {
        return `https://dev.azure.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.project!)}`;
    }

    private async fetchWithAuth(url: string, accept = 'application/json'): Promise<Response> {
        const pat = getResolvedAzureDevOpsPat();

        const headers: Record<string, string> = {
            'Accept': accept,
        };

        if (pat) {
            // ADO PAT auth: Basic with empty username
            headers['Authorization'] = `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
        }

        return fetch(url, { headers });
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
