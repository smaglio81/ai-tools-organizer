/**
 * Area Views Test Suite
 *
 * Tests that each content area's InstalledAreaTreeDataProvider correctly
 * scans the mock filesystem and returns the expected installed items.
 * Also tests the install → scan → green-check flow.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { InstalledAreaTreeDataProvider } from '../views/installedAreaProvider';
import { SkillPathService } from '../services/skillPathService';
import { ContentArea, InstalledSkill } from '../types';
import {
    MockFileSystem,
    MockDirectory,
    MOCK_AGENTS_DIR,
    MOCK_HOOKS_GITHUB_DIR,
    MOCK_HOOKS_KIRO_DIR,
    MOCK_INSTRUCTIONS_DIR,
    MOCK_PLUGINS_DIR,
    MOCK_PROMPTS_DIR,
    EXPECTED_AGENTS,
    EXPECTED_HOOKS_GITHUB,
    EXPECTED_HOOKS_KIRO,
    EXPECTED_INSTRUCTIONS,
    EXPECTED_PLUGINS,
    EXPECTED_PROMPTS,
} from './fixtures/installedAreaMocks';

// ─── Test helpers ────────────────────────────────────────────────────────────

const HOME = '/home/testuser';
const WORKSPACE = '/workspace';

/**
 * Build a MockFileSystem with the given area directory mounted at ~/.copilot/{areaDir}.
 * For hooksKiro, mounts at {workspace}/.kiro/hooks instead.
 */
function buildMockFs(area: ContentArea, areaDir: MockDirectory): MockFileSystem {
    if (area === 'hooksKiro') {
        // .kiro/hooks is workspace-relative
        return new MockFileSystem({
            'workspace': { type: 'directory', children: {
                '.kiro': { type: 'directory', children: {
                    'hooks': areaDir
                }}
            }},
            'home': { type: 'directory', children: {
                'testuser': { type: 'directory', children: {
                    '.copilot': { type: 'directory', children: {
                        'skills': { type: 'directory', children: {} }
                    }}
                }}
            }}
        });
    }

    const conventionalDir = getConventionalDir(area);
    return new MockFileSystem({
        'home': { type: 'directory', children: {
            'testuser': { type: 'directory', children: {
                '.copilot': { type: 'directory', children: {
                    [conventionalDir]: areaDir,
                    'skills': { type: 'directory', children: {} }
                }}
            }}
        }}
    });
}

function getConventionalDir(area: ContentArea): string {
    const map: Record<string, string> = {
        agents: 'agents', hooksGithub: 'hooks', hooksKiro: 'hooks',
        instructions: 'instructions', plugins: 'plugins',
        prompts: 'prompts', skills: 'skills'
    };
    return map[area] || area;
}

/**
 * Create a TestSkillPathService that uses the given MockFileSystem.
 */
function createTestPathService(mockFs: MockFileSystem, _area: ContentArea): SkillPathService {
    class TestPathService extends SkillPathService {
        override getFileSystem(): vscode.FileSystem { return mockFs; }
        override getHomeDirectory(): string { return `${HOME}`; }
        override getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
            return { uri: vscode.Uri.file(WORKSPACE), name: 'test-workspace', index: 0 };
        }
        override getScanLocations(): string[] {
            return ['~/.copilot/skills'];
        }
        override getDefaultDownloadLocation(a: ContentArea): string {
            if (a === 'hooksKiro') { return '.kiro/hooks'; }
            const dir = getConventionalDir(a);
            return `~/.copilot/${dir}`;
        }
    }
    return new TestPathService();
}

/**
 * Assert that scan results match expected items (ignoring installedAt timestamps).
 */
function assertItemsMatch(actual: InstalledSkill[], expected: { name: string; description: string; location: string }[]): void {
    const sorted = [...actual].sort((a, b) => a.name.localeCompare(b.name));
    const expectedSorted = [...expected].sort((a, b) => a.name.localeCompare(b.name));

    assert.strictEqual(sorted.length, expectedSorted.length,
        `Expected ${expectedSorted.length} items but got ${sorted.length}: [${sorted.map(s => s.name).join(', ')}]`);

    for (let i = 0; i < sorted.length; i++) {
        assert.strictEqual(sorted[i].name, expectedSorted[i].name, `Item ${i} name mismatch`);
        assert.strictEqual(sorted[i].description, expectedSorted[i].description, `Item ${i} description mismatch`);
        assert.strictEqual(sorted[i].location, expectedSorted[i].location, `Item ${i} location mismatch`);
    }
}


// ─── Test suites ─────────────────────────────────────────────────────────────

suite('Area Views Test Suite', () => {

    const mockContext = {
        workspaceState: { get: () => [], update: async () => undefined, keys: () => [] },
        subscriptions: []
    } as unknown as vscode.ExtensionContext;

    // ─── Scan tests per area ─────────────────────────────────────────────

    suite('Agents area scan', () => {
        test('discovers all agent files including nested subfolders', async () => {
            const mockFs = buildMockFs('agents', MOCK_AGENTS_DIR);
            const pathService = createTestPathService(mockFs, 'agents');
            const provider = new InstalledAreaTreeDataProvider(mockContext, pathService, 'agents', 'agentOrganizer.agents');
            const items = await provider.scanInstalledItems();
            assertItemsMatch(items, EXPECTED_AGENTS);
        });
    });

    suite('Hooks - GitHub area scan', () => {
        test('discovers hook folders with hooks.json', async () => {
            const mockFs = buildMockFs('hooksGithub', MOCK_HOOKS_GITHUB_DIR);
            const pathService = createTestPathService(mockFs, 'hooksGithub');
            const provider = new InstalledAreaTreeDataProvider(mockContext, pathService, 'hooksGithub', 'agentOrganizer.hooksGithub');
            const items = await provider.scanInstalledItems();
            assertItemsMatch(items, EXPECTED_HOOKS_GITHUB);
        });
    });

    suite('Hooks - Kiro area scan', () => {
        test('discovers JSON files in .kiro/hooks', async () => {
            const mockFs = buildMockFs('hooksKiro', MOCK_HOOKS_KIRO_DIR);
            const pathService = createTestPathService(mockFs, 'hooksKiro');
            const provider = new InstalledAreaTreeDataProvider(mockContext, pathService, 'hooksKiro', 'agentOrganizer.hooksKiro');
            const items = await provider.scanInstalledItems();
            assertItemsMatch(items, EXPECTED_HOOKS_KIRO);
        });
    });

    suite('Instructions area scan', () => {
        test('discovers instruction files', async () => {
            const mockFs = buildMockFs('instructions', MOCK_INSTRUCTIONS_DIR);
            const pathService = createTestPathService(mockFs, 'instructions');
            const provider = new InstalledAreaTreeDataProvider(mockContext, pathService, 'instructions', 'agentOrganizer.instructions');
            const items = await provider.scanInstalledItems();
            assertItemsMatch(items, EXPECTED_INSTRUCTIONS);
        });
    });

    suite('Plugins area scan', () => {
        test('discovers plugins with nested and root-level plugin.json', async () => {
            const mockFs = buildMockFs('plugins', MOCK_PLUGINS_DIR);
            const pathService = createTestPathService(mockFs, 'plugins');
            const provider = new InstalledAreaTreeDataProvider(mockContext, pathService, 'plugins', 'agentOrganizer.plugins');
            const items = await provider.scanInstalledItems();
            assertItemsMatch(items, EXPECTED_PLUGINS);
        });
    });

    suite('Prompts area scan', () => {
        test('discovers prompt files including nested subfolders', async () => {
            const mockFs = buildMockFs('prompts', MOCK_PROMPTS_DIR);
            const pathService = createTestPathService(mockFs, 'prompts');
            const provider = new InstalledAreaTreeDataProvider(mockContext, pathService, 'prompts', 'agentOrganizer.prompts');
            const items = await provider.scanInstalledItems();
            assertItemsMatch(items, EXPECTED_PROMPTS);
        });
    });

    suite('Skills area scan', () => {
        // Note: Skills use the dedicated InstalledSkillsTreeDataProvider, not InstalledAreaTreeDataProvider.
        // Skills scan tests are in extension.test.ts.
        test('skills area provider is not used (skills have dedicated provider)', () => {
            // This is a placeholder — skills scanning is tested via InstalledSkillsTreeDataProvider
            assert.ok(true);
        });
    });

    // ─── Empty directory tests ───────────────────────────────────────────

    suite('Empty area scan', () => {
        test('returns empty array when area directory is empty', async () => {
            const emptyDir = { type: 'directory' as const, children: {} };
            const mockFs = buildMockFs('agents', emptyDir);
            const pathService = createTestPathService(mockFs, 'agents');
            const provider = new InstalledAreaTreeDataProvider(mockContext, pathService, 'agents', 'agentOrganizer.agents');
            const items = await provider.scanInstalledItems();
            assert.strictEqual(items.length, 0, 'Expected no items in empty directory');
        });

        test('returns empty array when area directory does not exist', async () => {
            const mockFs = new MockFileSystem({
                'home': { type: 'directory', children: {
                    'testuser': { type: 'directory', children: {
                        '.copilot': { type: 'directory', children: {
                            'skills': { type: 'directory', children: {} }
                            // No 'agents' directory
                        }}
                    }}
                }}
            });
            const pathService = createTestPathService(mockFs, 'agents');
            const provider = new InstalledAreaTreeDataProvider(mockContext, pathService, 'agents', 'agentOrganizer.agents');
            const items = await provider.scanInstalledItems();
            assert.strictEqual(items.length, 0, 'Expected no items when directory missing');
        });
    });


    // ─── Install → scan → green-check flow tests ────────────────────────

    suite('Install and detect flow', () => {
        test('installing a single-file agent makes it discoverable', async () => {
            // Start with empty agents directory
            const mockFs = buildMockFs('agents', { type: 'directory', children: {} });
            const pathService = createTestPathService(mockFs, 'agents');
            const provider = new InstalledAreaTreeDataProvider(mockContext, pathService, 'agents', 'agentOrganizer.agents');

            // Verify empty before install
            let items = await provider.scanInstalledItems();
            assert.strictEqual(items.length, 0);

            // Simulate downloading an agent file (what the install command does)
            const agentContent = '---\nname: new-agent\ndescription: A freshly downloaded agent\n---\nAgent content.';
            const targetDir = pathService.resolveLocationToUri('~/.copilot/agents', undefined);
            assert.ok(targetDir, 'Target directory should resolve');
            await mockFs.createDirectory(targetDir!);
            const fileUri = vscode.Uri.joinPath(targetDir!, 'new-agent.agent.md');
            await mockFs.writeFile(fileUri, new TextEncoder().encode(agentContent));

            // Verify the file was written
            const node = mockFs.resolve(`${HOME}/.copilot/agents/new-agent.agent.md`);
            assert.ok(node, 'Agent file should exist in mock FS');
            assert.strictEqual(node!.type, 'file');

            // Re-scan — the new agent should be discovered
            await provider.refresh();
            items = provider.getInstalledItems();
            assert.strictEqual(items.length, 1, 'Should find 1 agent after install');
            assert.strictEqual(items[0].name, 'new-agent');
            // Note: scanSingleFiles doesn't parse frontmatter for descriptions
            assert.strictEqual(items[0].description, '');

            // Verify the name would appear in the installed names set (for green check)
            const installedNames = provider.getInstalledItemNames();
            assert.ok(installedNames.has('new-agent'), 'Installed names should include the new agent');
        });

        test('installing a multi-file plugin with nested plugin.json makes it discoverable', async () => {
            const mockFs = buildMockFs('plugins', { type: 'directory', children: {} });
            const pathService = createTestPathService(mockFs, 'plugins');
            const provider = new InstalledAreaTreeDataProvider(mockContext, pathService, 'plugins', 'agentOrganizer.plugins');

            // Verify empty before install
            let items = await provider.scanInstalledItems();
            assert.strictEqual(items.length, 0);

            // Simulate downloading a plugin with nested plugin.json
            const targetDir = pathService.resolveLocationToUri('~/.copilot/plugins', undefined);
            assert.ok(targetDir);
            const pluginDir = vscode.Uri.joinPath(targetDir!, 'my-plugin');
            const nestedDir = vscode.Uri.joinPath(pluginDir, '.github', 'plugin');
            await mockFs.createDirectory(nestedDir);
            await mockFs.writeFile(
                vscode.Uri.joinPath(nestedDir, 'plugin.json'),
                new TextEncoder().encode(JSON.stringify({ name: 'My Plugin', description: 'A test plugin' }))
            );
            await mockFs.writeFile(
                vscode.Uri.joinPath(pluginDir, 'README.md'),
                new TextEncoder().encode('# My Plugin\nA test plugin.')
            );

            // Re-scan — the plugin should be found via recursive definition file search
            await provider.refresh();
            items = provider.getInstalledItems();
            assert.strictEqual(items.length, 1, 'Should find 1 plugin after install');
            assert.strictEqual(items[0].name, 'My Plugin');
            assert.strictEqual(items[0].description, 'A test plugin');

            const installedNames = provider.getInstalledItemNames();
            assert.ok(installedNames.has('My Plugin'), 'Installed names should include the plugin');
        });

        test('installing a GitHub hook makes it discoverable', async () => {
            const mockFs = buildMockFs('hooksGithub', { type: 'directory', children: {} });
            const pathService = createTestPathService(mockFs, 'hooksGithub');
            const provider = new InstalledAreaTreeDataProvider(mockContext, pathService, 'hooksGithub', 'agentOrganizer.hooksGithub');

            let items = await provider.scanInstalledItems();
            assert.strictEqual(items.length, 0);

            // Simulate downloading a hook
            const targetDir = pathService.resolveLocationToUri('~/.copilot/hooks', undefined);
            assert.ok(targetDir);
            const hookDir = vscode.Uri.joinPath(targetDir!, 'my-hook');
            await mockFs.createDirectory(hookDir);
            await mockFs.writeFile(
                vscode.Uri.joinPath(hookDir, 'hooks.json'),
                new TextEncoder().encode(JSON.stringify({ name: 'My Hook', description: 'A test hook' }))
            );

            items = await provider.scanInstalledItems();
            assert.strictEqual(items.length, 1);
            assert.strictEqual(items[0].name, 'My Hook');
        });

        test('deleting an installed item removes it from scan results', async () => {
            // Start with one agent installed
            const mockFs = buildMockFs('agents', {
                type: 'directory',
                children: {
                    'temp-agent.agent.md': {
                        type: 'file',
                        content: '---\nname: temp-agent\ndescription: Temporary\n---\nContent.'
                    }
                }
            });
            const pathService = createTestPathService(mockFs, 'agents');
            const provider = new InstalledAreaTreeDataProvider(mockContext, pathService, 'agents', 'agentOrganizer.agents');

            let items = await provider.scanInstalledItems();
            assert.strictEqual(items.length, 1, 'Should find 1 agent before delete');

            // Delete the file
            const targetDir = pathService.resolveLocationToUri('~/.copilot/agents', undefined);
            assert.ok(targetDir);
            await mockFs.delete(vscode.Uri.joinPath(targetDir!, 'temp-agent.agent.md'));

            // Re-scan — should be empty
            items = await provider.scanInstalledItems();
            assert.strictEqual(items.length, 0, 'Should find 0 agents after delete');

            const installedNames = provider.getInstalledItemNames();
            assert.ok(!installedNames.has('temp-agent'), 'Installed names should not include deleted agent');
        });

        test('write log tracks all file writes during install', async () => {
            const mockFs = buildMockFs('prompts', { type: 'directory', children: {} });
            const pathService = createTestPathService(mockFs, 'prompts');

            const targetDir = pathService.resolveLocationToUri('~/.copilot/prompts', undefined);
            assert.ok(targetDir);
            await mockFs.writeFile(
                vscode.Uri.joinPath(targetDir!, 'my-prompt.prompt.md'),
                new TextEncoder().encode('---\nname: my-prompt\ndescription: Test\n---\nContent.')
            );

            assert.strictEqual(mockFs.writeLog.length, 1, 'Should have 1 write log entry');
            assert.ok(mockFs.writeLog[0].path.includes('my-prompt.prompt.md'), 'Write log should contain the file path');
        });
    });

    // ─── Duplicate lifecycle: copy → detect → edit → recompare → delete ──

    suite('Duplicate detection lifecycle', () => {
        test('copy → blue, edit → newest/older, delete → unique', async () => {
            // Step 0: Start with one agent in location A
            const agentContent = '---\nname: my-agent\ndescription: Original\n---\nOriginal content.';
            const initialMtime = Date.now() - 10000; // 10 seconds ago
            const mockFs = new MockFileSystem({
                'home': { type: 'directory', children: {
                    'testuser': { type: 'directory', children: {
                        '.copilot': { type: 'directory', children: {
                            'agents': { type: 'directory', children: {
                                'my-agent.agent.md': { type: 'file', content: agentContent, mtime: initialMtime }
                            }},
                            'skills': { type: 'directory', children: {} }
                        }},
                        '.claude': { type: 'directory', children: {
                            'agents': { type: 'directory', children: {} }
                        }}
                    }}
                }}
            });

            // Override getScanLocations to include both locations
            class DualLocationPathService extends SkillPathService {
                override getFileSystem(): vscode.FileSystem { return mockFs; }
                override getHomeDirectory(): string { return HOME; }
                override getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
                    return { uri: vscode.Uri.file(WORKSPACE), name: 'test-workspace', index: 0 };
                }
                override getScanLocations(): string[] {
                    return ['~/.copilot/skills', '~/.claude/skills'];
                }
                override getDefaultDownloadLocation(_a: ContentArea): string {
                    return '~/.copilot/agents';
                }
            }

            const pathService = new DualLocationPathService();
            const provider = new InstalledAreaTreeDataProvider(mockContext, pathService, 'agents', 'agentOrganizer.agents');

            // Initial scan: 1 agent, should be unique (purple)
            await provider.refresh();
            let items = provider.getInstalledItems();
            assert.strictEqual(items.length, 1, 'Should start with 1 agent');
            assert.strictEqual(provider.getDuplicateStatus(items[0].location), 'unique',
                'Single agent should be unique (purple)');

            // Step 1: Copy the agent to location B (~/.claude/agents/)
            // Write with same mtime as original so they're detected as "same"
            const locationB = pathService.resolveLocationToUri('~/.claude/agents', undefined);
            assert.ok(locationB);
            const copyUri = vscode.Uri.joinPath(locationB!, 'my-agent.agent.md');
            await mockFs.writeFile(copyUri, new TextEncoder().encode(agentContent));
            // Override mtime to match original
            const copyNode = mockFs.resolve(`${HOME}/.claude/agents/my-agent.agent.md`);
            if (copyNode && copyNode.type === 'file') { copyNode.mtime = initialMtime; }

            // Step 2: Refresh — both copies should be "same" (blue)
            await provider.refresh();
            items = provider.getInstalledItems();
            assert.strictEqual(items.length, 2, 'Should have 2 agents after copy');
            for (const item of items) {
                assert.strictEqual(provider.getDuplicateStatus(item.location), 'same',
                    `Agent at ${item.location} should be same (blue)`);
            }

            // Step 3: Edit the copy (simulate saving the file with new content)
            // Small delay to ensure mtime differs from the original write
            await new Promise(resolve => setTimeout(resolve, 10));
            const editedContent = '---\nname: my-agent\ndescription: Original\n---\nEdited content with changes.';
            await mockFs.writeFile(copyUri, new TextEncoder().encode(editedContent));

            // Step 4: Refresh — should detect newest vs older
            // (In real usage, the file watcher's onDidChange triggers refresh())
            await provider.refresh();
            items = provider.getInstalledItems();
            assert.strictEqual(items.length, 2, 'Should still have 2 agents');

            const locationAItem = items.find(i => i.location.includes('.copilot'));
            const locationBItem = items.find(i => i.location.includes('.claude'));
            assert.ok(locationAItem, 'Should find agent in .copilot');
            assert.ok(locationBItem, 'Should find agent in .claude');

            // The edited copy (B) should be newest, the original (A) should be older
            const statusA = provider.getDuplicateStatus(locationAItem!.location);
            const statusB = provider.getDuplicateStatus(locationBItem!.location);
            assert.ok(
                (statusB === 'newest' && statusA === 'older') ||
                (statusA === 'newest' && statusB === 'older'),
                `Expected one newest and one older, got A=${statusA} B=${statusB}`
            );
            // Since B was written after A, B should be newest
            assert.strictEqual(statusB, 'newest',
                'Edited copy should be newest (green)');
            assert.strictEqual(statusA, 'older',
                'Original should be older (orange)');

            // Step 5: Delete the copy to return to original state
            await mockFs.delete(copyUri);

            await provider.refresh();
            items = provider.getInstalledItems();
            assert.strictEqual(items.length, 1, 'Should have 1 agent after delete');
            assert.strictEqual(provider.getDuplicateStatus(items[0].location), 'unique',
                'Remaining agent should be unique (purple)');
        });
    });
});
