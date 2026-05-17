/**
 * Azure DevOps Git URL parsing (shared by extension UI and repository config resolution).
 */

/**
 * Strip `userinfo@` from an https URL (clone URLs often embed org name or a PAT prefix).
 */
export function stripGitCredentialPrefix(input: string): string {
    const trimmed = input.trim();
    let withScheme = trimmed;
    if (!/^https?:\/\//i.test(withScheme)) {
        withScheme = `https://${withScheme.replace(/^\/+/, '')}`;
    }
    return withScheme.replace(/^(https?:\/\/)[^@/]+@/i, '$1');
}

/**
 * Parse an Azure DevOps Git URL into its SkillRepository components.
 * Handles:
 *   https://dev.azure.com/{org}/{project}/_git/{repo}
 *   https://{user}@dev.azure.com/{org}/{project}/_git/{repo}
 *   {org}.visualstudio.com/{project}/_git/{repo} (with or without https://)
 *   The above with an optional `version=GB{branch}` query parameter.
 *
 * Returns undefined when the input cannot be parsed as an ADO Git URL.
 * `branch` is undefined when not present in the URL (caller should resolve via API).
 */
export function parseAzureDevOpsGitUrl(input: string): { owner: string; project: string; repo: string; branch: string | undefined } | undefined {
    const trimmed = input.trim();
    if (!trimmed) {
        return undefined;
    }

    const withoutCreds = stripGitCredentialPrefix(trimmed);

    let url: URL;
    try {
        url = new URL(withoutCreds);
    } catch {
        return undefined;
    }

    const host = url.hostname.toLowerCase();

    const pathParts = url.pathname.split('/').filter(p => p.length > 0);
    const gitIdx = pathParts.indexOf('_git');
    if (gitIdx < 1 || gitIdx >= pathParts.length - 1) {
        return undefined;
    }

    const repo = pathParts[gitIdx + 1].replace(/\.git$/, '');
    const beforeGit = pathParts.slice(0, gitIdx);

    let owner: string;
    let project: string;

    if (host === 'dev.azure.com') {
        // /{org}/{project}/_git/{repo}
        if (beforeGit.length !== 2) {
            return undefined;
        }
        owner = beforeGit[0];
        project = beforeGit[1];
    } else if (host.endsWith('.visualstudio.com')) {
        const sub = host.slice(0, -'.visualstudio.com'.length);
        if (!sub || sub.includes('.')) {
            return undefined;
        }
        owner = sub;
        // /{project}/_git/{repo} or /DefaultCollection/{project}/_git/{repo}
        if (beforeGit.length === 1) {
            project = beforeGit[0];
        } else if (beforeGit.length === 2 && beforeGit[0].toLowerCase() === 'defaultcollection') {
            project = beforeGit[1];
        } else {
            return undefined;
        }
    } else {
        return undefined;
    }

    // Optional branch from query: version=GB<branch>
    let branch: string | undefined;
    const version = url.searchParams.get('version');
    if (version && version.toUpperCase().startsWith('GB')) {
        branch = version.slice(2) || undefined;
    }

    return { owner, project, repo, branch };
}
