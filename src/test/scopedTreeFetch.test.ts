/**
 * Scoped Tree Fetch Tests
 *
 * Verifies that fetchMergedInterestingTree (via discoverAreas / fetchSkillFiles)
 * only requests subtrees for interesting top-level directories, and that the
 * correct content is discovered across the supported layouts.
 *
 * Uses a fake RepoTransport to avoid any network calls.
 */

import * as assert from 'assert';
import { RepoTransport, RepoTreeItem } from '../repos/repoTransport';
import { SkillRepository } from '../types';

// ─── Fake transport ───────────────────────────────────────────────────────────

interface FakeTree {
    root: RepoTreeItem[];
    subtrees: Record<string, RepoTreeItem[]>;
    files: Record<string, string>;
}

class FakeRepoTransport implements RepoTransport {
    readonly fetchedSubtrees: string[] = [];

    constructor(private readonly tree: FakeTree) {}

    async fetchRootTreeEntries(_repo: SkillRepository): Promise<RepoTreeItem[]> {
        return this.tree.root;
    }

    async fetchSubtreeRecursive(_repo: SkillRepository, prefixPath: string): Promise<RepoTreeItem[]> {
        this.fetchedSubtrees.push(prefixPath);
        return this.tree.subtrees[prefixPath] ?? [];
    }

    async fetchFileText(_repo: SkillRepository, path: string): Promise<string> {
        if (path in this.tree.files) { return this.tree.files[path]; }
        throw new Error(`File not found: ${path}`);
    }

    async fetchDefaultBranch(_repo: SkillRepository): Promise<string> {
        return 'main';
    }
}

// ─── Helper: inject fake transport into client ────────────────────────────────

import { GitHubSkillsClient } from '../github/skillsClient';
import * as vscode from 'vscode';

/** Build a GitHubSkillsClient whose transport is replaced with the given fake. */
function buildClientWithFakeTransport(transport: FakeRepoTransport): GitHubSkillsClient {
    const client = new GitHubSkillsClient({ extensionUri: vscode.Uri.file('/fake') } as unknown as vscode.ExtensionContext);
    // Replace both transports so isAdoRepository(repo) selects the fake correctly
    (client as any).ghTransport = transport;
    (client as any).adoTransport = transport;
    return client;
}

const REPO: SkillRepository = { owner: 'test', repo: 'repo', branch: 'main' };

// ─── Tests ────────────────────────────────────────────────────────────────────

suite('Scoped Tree Fetch — prefix allowlist', () => {
    test('only fetches subtrees for interesting root directories', async () => {
        const transport = new FakeRepoTransport({
            root: [
                { path: 'skills', type: 'tree' },
                { path: '.cursor', type: 'tree' },
                { path: 'docs', type: 'tree' },        // not interesting
                { path: '.github', type: 'tree' },     // included as dot-tool dir
                { path: 'node_modules', type: 'tree' },// not interesting
                { path: 'README.md', type: 'blob' },
            ],
            subtrees: {
                'skills': [
                    { path: 'skills/my-skill', type: 'tree' },
                    { path: 'skills/my-skill/SKILL.md', type: 'blob' },
                ],
                '.cursor': [
                    { path: '.cursor/rules', type: 'tree' },
                    { path: '.cursor/rules/my-rule.mdc', type: 'blob' },
                ],
                '.github': [
                    { path: '.github/copilot-instructions.md', type: 'blob' },
                ],
            },
            files: {
                'skills/my-skill/SKILL.md': '---\nname: My Skill\ndescription: desc\n---\nBody',
            },
        });

        const client = buildClientWithFakeTransport(transport);
        const areas = await client.discoverAreas(REPO);

        assert.ok(transport.fetchedSubtrees.includes('skills'), 'should fetch skills subtree');
        assert.ok(transport.fetchedSubtrees.includes('.cursor'), 'should fetch .cursor subtree');
        assert.ok(transport.fetchedSubtrees.includes('.github'), 'should fetch .github subtree');
        assert.ok(!transport.fetchedSubtrees.includes('docs'), 'should NOT fetch docs subtree');
        assert.ok(!transport.fetchedSubtrees.includes('node_modules'), 'should NOT fetch node_modules subtree');

        assert.strictEqual(areas['skills'], 'skills', 'skills area should be discovered');
    });

    test('discovers agents via .github when repo only has .github/agents/', async () => {
        const transport = new FakeRepoTransport({
            root: [
                { path: '.github', type: 'tree' },
            ],
            subtrees: {
                '.github': [
                    { path: '.github/agents', type: 'tree' },
                    { path: '.github/agents/my.agent.md', type: 'blob' },
                ],
            },
            files: {},
        });

        const client = buildClientWithFakeTransport(transport);
        const areas = await client.discoverAreas(REPO);

        assert.ok(transport.fetchedSubtrees.includes('.github'), '.github should be fetched');
        assert.strictEqual(areas['agents'], '.github', 'agents should be discovered via .github');
    });
});

suite('Scoped Tree Fetch — conventional top-level directories', () => {
    test('discovers agents, hooks, instructions from conventional root dirs', async () => {
        const transport = new FakeRepoTransport({
            root: [
                { path: 'agents', type: 'tree' },
                { path: 'hooks', type: 'tree' },
                { path: 'instructions', type: 'tree' },
            ],
            subtrees: {
                'agents': [
                    { path: 'agents/my.agent.md', type: 'blob' },
                ],
                'hooks': [
                    { path: 'hooks/my-hook', type: 'tree' },
                    { path: 'hooks/my-hook/hooks.json', type: 'blob' },
                ],
                'instructions': [
                    { path: 'instructions/setup.instructions.md', type: 'blob' },
                ],
            },
            files: {},
        });

        const client = buildClientWithFakeTransport(transport);
        const areas = await client.discoverAreas(REPO);

        assert.strictEqual(areas['agents'], 'agents');
        assert.strictEqual(areas['hooksGithub'], 'hooks');
        assert.strictEqual(areas['instructions'], 'instructions');
    });
});

suite('Scoped Tree Fetch — .cursor-plugin marketplace', () => {
    test('augments prefix set with plugin dirs from marketplace.json', async () => {
        const marketplaceJson = JSON.stringify({
            plugins: [
                { name: 'Plugin A', source: 'plugin-a' },
                { name: 'Plugin B', source: 'plugin-b' },
            ],
        });

        const transport = new FakeRepoTransport({
            root: [
                { path: '.cursor-plugin', type: 'tree' },
                { path: 'plugin-a', type: 'tree' },
                { path: 'plugin-b', type: 'tree' },
            ],
            subtrees: {
                '.cursor-plugin': [
                    { path: '.cursor-plugin/marketplace.json', type: 'blob' },
                ],
                'plugin-a': [
                    { path: 'plugin-a/.cursor-plugin', type: 'tree' },
                    { path: 'plugin-a/.cursor-plugin/plugin.json', type: 'blob' },
                ],
                'plugin-b': [
                    { path: 'plugin-b/.cursor-plugin', type: 'tree' },
                    { path: 'plugin-b/.cursor-plugin/plugin.json', type: 'blob' },
                ],
            },
            files: {
                '.cursor-plugin/marketplace.json': marketplaceJson,
                'plugin-a/.cursor-plugin/plugin.json': JSON.stringify({ name: 'Plugin A', description: 'Desc A' }),
                'plugin-b/.cursor-plugin/plugin.json': JSON.stringify({ name: 'Plugin B', description: 'Desc B' }),
            },
        });

        const client = buildClientWithFakeTransport(transport);
        const areas = await client.discoverAreas(REPO);

        assert.ok(transport.fetchedSubtrees.includes('.cursor-plugin'), 'should fetch .cursor-plugin subtree');
        assert.ok(transport.fetchedSubtrees.includes('plugin-a'), 'should fetch plugin-a subtree');
        assert.ok(transport.fetchedSubtrees.includes('plugin-b'), 'should fetch plugin-b subtree');
        assert.strictEqual(areas['plugins'], '.cursor-plugin/marketplace');
    });

    test('marketplace with pluginRoot prefix adds top-level segment only', async () => {
        const marketplaceJson = JSON.stringify({
            metadata: { pluginRoot: 'plugins' },
            plugins: [
                { name: 'Plugin X', source: 'plugin-x' },
            ],
        });

        const transport = new FakeRepoTransport({
            root: [
                { path: '.cursor-plugin', type: 'tree' },
                { path: 'plugins', type: 'tree' },
            ],
            subtrees: {
                '.cursor-plugin': [
                    { path: '.cursor-plugin/marketplace.json', type: 'blob' },
                ],
                'plugins': [
                    { path: 'plugins/plugin-x', type: 'tree' },
                    { path: 'plugins/plugin-x/.cursor-plugin', type: 'tree' },
                    { path: 'plugins/plugin-x/.cursor-plugin/plugin.json', type: 'blob' },
                ],
            },
            files: {
                '.cursor-plugin/marketplace.json': marketplaceJson,
                'plugins/plugin-x/.cursor-plugin/plugin.json': JSON.stringify({ name: 'Plugin X', description: 'Desc' }),
            },
        });

        const client = buildClientWithFakeTransport(transport);
        const areas = await client.discoverAreas(REPO);

        assert.ok(transport.fetchedSubtrees.includes('plugins'), 'should fetch plugins subtree (top-level segment of pluginRoot/plugin-x)');
        assert.strictEqual(areas['plugins'], '.cursor-plugin/marketplace');
    });

    test('marketplace source with ./ prefix maps to real subtree root (not ".")', async () => {
        const marketplaceJson = JSON.stringify({
            plugins: [
                { name: 'Demo', source: './plugins/encompass-demo/' },
            ],
        });

        const transport = new FakeRepoTransport({
            root: [
                { path: '.cursor-plugin', type: 'tree' },
                { path: 'plugins', type: 'tree' },
            ],
            subtrees: {
                '.cursor-plugin': [
                    { path: '.cursor-plugin/marketplace.json', type: 'blob' },
                ],
                plugins: [
                    { path: 'plugins/encompass-demo', type: 'tree' },
                    { path: 'plugins/encompass-demo/.cursor-plugin/plugin.json', type: 'blob' },
                ],
            },
            files: {
                '.cursor-plugin/marketplace.json': marketplaceJson,
                'plugins/encompass-demo/.cursor-plugin/plugin.json': JSON.stringify({ name: 'Demo', description: 'D' }),
            },
        });

        const client = buildClientWithFakeTransport(transport);
        await client.discoverAreas(REPO);

        assert.ok(transport.fetchedSubtrees.includes('plugins'), 'should fetch plugins subtree');
        assert.ok(!transport.fetchedSubtrees.includes('.'), 'must not treat ./... as a "." subtree scope');
    });

    test('marketplace with no manifest file sets no plugins area', async () => {
        const transport = new FakeRepoTransport({
            root: [
                { path: 'skills', type: 'tree' },
            ],
            subtrees: {
                'skills': [
                    { path: 'skills/my-skill/SKILL.md', type: 'blob' },
                ],
            },
            files: {
                'skills/my-skill/SKILL.md': '---\nname: My Skill\ndescription: d\n---\nBody',
            },
        });

        const client = buildClientWithFakeTransport(transport);
        const areas = await client.discoverAreas(REPO);

        assert.strictEqual(areas['plugins'], undefined, 'no plugins area when no marketplace.json');
        assert.strictEqual(areas['skills'], 'skills');
    });
});

suite('Scoped Tree Fetch — fetchSkillFiles subtree scoping', () => {
    test('fetchSkillFiles only fetches the skill top-level subtree', async () => {
        const transport = new FakeRepoTransport({
            root: [
                { path: 'skills', type: 'tree' },
            ],
            subtrees: {
                'skills': [
                    { path: 'skills/my-skill', type: 'tree' },
                    { path: 'skills/my-skill/SKILL.md', type: 'blob' },
                    { path: 'skills/my-skill/helper.sh', type: 'blob' },
                ],
            },
            files: {
                'skills/my-skill/SKILL.md': '# My Skill',
                'skills/my-skill/helper.sh': '#!/bin/sh',
            },
        });

        const client = buildClientWithFakeTransport(transport);

        const skill = {
            name: 'my-skill',
            description: 'test',
            source: REPO,
            skillPath: 'skills/my-skill',
            area: 'skills' as const,
        };

        transport.fetchedSubtrees.length = 0; // reset
        const files = await client.fetchSkillFiles(skill);

        // Should have requested only the 'skills' subtree (top-level prefix)
        assert.ok(transport.fetchedSubtrees.includes('skills'), 'should fetch skills subtree for install');
        assert.strictEqual(files.length, 2, 'should return SKILL.md and helper.sh');

        const names = files.map(f => f.path).sort();
        assert.deepStrictEqual(names, ['SKILL.md', 'helper.sh']);
    });
});
