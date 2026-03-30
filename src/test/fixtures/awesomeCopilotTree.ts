/**
 * Mock GitHub Git Tree response for github/awesome-copilot (trimmed).
 * Contains representative items from each content area for unit testing.
 * Based on a real scan of https://github.com/github/awesome-copilot at main.
 */

import { GitHubTreeItem } from '../../types';

export const AWESOME_COPILOT_REPO = {
    owner: 'github',
    repo: 'awesome-copilot',
    branch: 'main'
};

/**
 * Trimmed tree with a few items per area for testing area discovery and content fetching.
 */
export const AWESOME_COPILOT_TREE: { tree: GitHubTreeItem[] } = {
    tree: [
        // --- Top-level directories ---
        { path: 'agents', mode: '040000', type: 'tree', sha: '4e69fdc0', url: '' },
        { path: 'hooks', mode: '040000', type: 'tree', sha: '9cc46e7e', url: '' },
        { path: 'instructions', mode: '040000', type: 'tree', sha: '914baac3', url: '' },
        { path: 'cookbook', mode: '040000', type: 'tree', sha: 'ddf00a79', url: '' },
        { path: 'docs', mode: '040000', type: 'tree', sha: '62fcf175', url: '' },
        { path: '.github', mode: '040000', type: 'tree', sha: '020825250', url: '' },
        { path: '.github/agents', mode: '040000', type: 'tree', sha: '8cd4464d', url: '' },
        { path: '.github/plugin', mode: '040000', type: 'tree', sha: '28ab897d', url: '' },

        // --- Agents (single-file: *.agent.md) ---
        { path: 'agents/accessibility.agent.md', mode: '100644', type: 'blob', sha: '10ec5d0e', size: 12689, url: '' },
        { path: 'agents/debug.agent.md', mode: '100644', type: 'blob', sha: '75de3b99', size: 3562, url: '' },
        { path: 'agents/github-actions-expert.agent.md', mode: '100644', type: 'blob', sha: '9ad33d99', size: 5482, url: '' },
        { path: 'agents/plan.agent.md', mode: '100644', type: 'blob', sha: '4d7252c4', size: 6774, url: '' },
        { path: 'agents/terraform.agent.md', mode: '100644', type: 'blob', sha: 'e9732f6b', size: 14365, url: '' },
        // Agent under .github/agents (should NOT be discovered — .github is not a conventional agents dir)
        { path: '.github/agents/agentic-workflows.agent.md', mode: '100644', type: 'blob', sha: '768e998f', size: 8446, url: '' },

        // --- Hooks - GitHub (multi-file: folders with hooks.json) ---
        { path: 'hooks/dependency-license-checker', mode: '040000', type: 'tree', sha: 'd7a3d9a4', url: '' },
        { path: 'hooks/dependency-license-checker/README.md', mode: '100644', type: 'blob', sha: '6d54f0cc', size: 8681, url: '' },
        { path: 'hooks/dependency-license-checker/check-licenses.sh', mode: '100755', type: 'blob', sha: '6e465d43', size: 13665, url: '' },
        { path: 'hooks/dependency-license-checker/hooks.json', mode: '100644', type: 'blob', sha: 'f1371b84', size: 290, url: '' },
        { path: 'hooks/secrets-scanner', mode: '040000', type: 'tree', sha: '849e01da', url: '' },
        { path: 'hooks/secrets-scanner/README.md', mode: '100644', type: 'blob', sha: 'cd5e21e0', size: 7934, url: '' },
        { path: 'hooks/secrets-scanner/hooks.json', mode: '100644', type: 'blob', sha: '1258880c', size: 306, url: '' },
        { path: 'hooks/secrets-scanner/scan-secrets.sh', mode: '100755', type: 'blob', sha: 'c5fee2e8', size: 10077, url: '' },
        { path: 'hooks/session-logger', mode: '040000', type: 'tree', sha: '0ebb8b6d', url: '' },
        { path: 'hooks/session-logger/README.md', mode: '100644', type: 'blob', sha: '3d544341', size: 1690, url: '' },
        { path: 'hooks/session-logger/hooks.json', mode: '100644', type: 'blob', sha: 'c4964d2a', size: 645, url: '' },
        { path: 'hooks/session-logger/log-prompt.sh', mode: '100755', type: 'blob', sha: 'a4f499e4', size: 534, url: '' },
        { path: 'hooks/tool-guardian', mode: '040000', type: 'tree', sha: 'f3dddaa6', url: '' },
        { path: 'hooks/tool-guardian/README.md', mode: '100644', type: 'blob', sha: '6e52b269', size: 7527, url: '' },
        { path: 'hooks/tool-guardian/hooks.json', mode: '100644', type: 'blob', sha: 'f26d6ac4', size: 264, url: '' },
        { path: 'hooks/tool-guardian/guard-tool.sh', mode: '100755', type: 'blob', sha: '3faac308', size: 8781, url: '' },

        // --- Instructions (single-file: *.instructions.md) ---
        { path: 'instructions/a11y.instructions.md', mode: '100644', type: 'blob', sha: 'd6d3d2c1', size: 12286, url: '' },
        { path: 'instructions/csharp.instructions.md', mode: '100644', type: 'blob', sha: '16355d2c', size: 5763, url: '' },
        { path: 'instructions/terraform.instructions.md', mode: '100644', type: 'blob', sha: 'placeholder', size: 4000, url: '' },

        // --- Misc files (should not match any area) ---
        { path: 'README.md', mode: '100644', type: 'blob', sha: '7bd87760', size: 70080, url: '' },
        { path: 'LICENSE', mode: '100644', type: 'blob', sha: '89bc5e96', size: 1059, url: '' },
        { path: 'CONTRIBUTING.md', mode: '100644', type: 'blob', sha: '3d8fba7c', size: 17232, url: '' },
        { path: '.github/copilot-instructions.md', mode: '100644', type: 'blob', sha: '0645f284', size: 3271, url: '' },
        { path: '.github/plugin/marketplace.json', mode: '100644', type: 'blob', sha: 'b74b3f7d', size: 23402, url: '' },
    ]
};

/**
 * Expected area discovery result for the mock tree above.
 */
export const EXPECTED_AREA_PATHS = {
    agents: 'agents',
    hooksGithub: 'hooks',
    instructions: 'instructions',
    // hooksKiro: not found (hooks.json folders found → hooksGithub takes precedence)
    // plugins: not found (no top-level plugins/ dir, no plugin.json in conventional location)
    // prompts: not found (no *.prompt.md files)
    // skills: not found (no SKILL.md files)
};
