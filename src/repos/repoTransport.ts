/**
 * RepoTransport — minimal interface that abstracts remote repository access.
 *
 * Concrete implementations:
 *   - GitHubRepoTransport  (src/repos/githubRepoTransport.ts)
 *   - AzureDevOpsRepoTransport (src/repos/azureDevOpsRepoTransport.ts)
 *
 * The higher-level GitHubSkillsClient (src/github/skillsClient.ts) uses this
 * interface so discovery and parsing logic is shared across both providers.
 */

import { SkillRepository } from '../types';

/**
 * Normalised tree item — common shape passed to discovery/fetch logic
 * regardless of which hosting provider produced it.
 */
export interface RepoTreeItem {
    /** Relative path within the repository, no leading slash. e.g. "skills/my-skill/SKILL.md" */
    path: string;
    type: 'blob' | 'tree';
}

export interface RepoTransport {
    /**
     * Fetch only the immediate (non-recursive) entries at the repository root.
     * Returns one RepoTreeItem per file or directory at the root level.
     * Implementors must normalise paths to have no leading slash.
     */
    fetchRootTreeEntries(repo: SkillRepository): Promise<RepoTreeItem[]>;

    /**
     * Recursively fetch all descendants of a single top-level directory.
     * `prefixPath` is a root-level directory name (no leading/trailing slash).
     * Returned paths are full repo-relative paths (e.g. "skills/my-skill/SKILL.md").
     * Implementors must normalise paths to have no leading slash and use forward slashes.
     */
    fetchSubtreeRecursive(repo: SkillRepository, prefixPath: string): Promise<RepoTreeItem[]>;

    /**
     * Fetch the raw text content of a single file.
     * `path` has no leading slash.
     */
    fetchFileText(repo: SkillRepository, path: string): Promise<string>;

    /**
     * Resolve the default branch name for a repository.
     * Returns 'main' as a safe fallback on error.
     */
    fetchDefaultBranch(repo: SkillRepository): Promise<string>;
}
