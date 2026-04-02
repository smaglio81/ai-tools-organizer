import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { InstalledSkillsTreeDataProvider } from '../views/installedProvider';
import { MarketplaceTreeDataProvider } from '../views/marketplaceProvider';
import { SkillInstallationService } from '../services/installationService';
import { SkillPathService } from '../services/skillPathService';
import { Skill, SkillRepository, InstalledSkill } from '../types';
import { GitHubSkillsClient } from '../github/skillsClient';
import { buildItemPathReference, parseGitHubUrl } from '../extension';
import { AreaInstalledItemTreeItem, AreaItemFileTreeItem, AreaItemFolderTreeItem } from '../views/installedAreaProvider';
import { InstalledSkillTreeItem, SkillFileTreeItem, SkillFolderTreeItem } from '../views/installedProvider';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	suite('buildItemPathReference', () => {
		test('returns the logical path for a top-level installed skill', () => {
			const installedSkill: InstalledSkill = {
				name: 'my-skill',
				description: 'Test skill',
				location: '~/.copilot/skills/my-skill',
				installedAt: new Date().toISOString()
			};
			const item = new InstalledSkillTreeItem(installedSkill, vscode.Uri.file('/home/test/.copilot/skills/my-skill'));

			assert.strictEqual(buildItemPathReference(item), '~/.copilot/skills/my-skill');
		});

		test('returns the logical path for a nested file inside an installed skill', () => {
			const installedSkill: InstalledSkill = {
				name: 'my-skill',
				description: 'Test skill',
				location: '~/.copilot/skills/my-skill',
				installedAt: new Date().toISOString()
			};
			const root = new InstalledSkillTreeItem(installedSkill, vscode.Uri.file('/home/test/.copilot/skills/my-skill'));
			const docs = new SkillFolderTreeItem(vscode.Uri.file('/home/test/.copilot/skills/my-skill/docs'), 'docs', root);
			const file = new SkillFileTreeItem(vscode.Uri.file('/home/test/.copilot/skills/my-skill/docs/guide.md'), 'guide.md', docs);

			assert.strictEqual(buildItemPathReference(file), '~/.copilot/skills/my-skill/docs/guide.md');
		});

		test('returns the logical path for a top-level installed area item', () => {
			const installedItem: InstalledSkill = {
				name: 'my-agent',
				description: 'Test agent',
				location: '~/.copilot/agents/my-agent.agent.md',
				installedAt: new Date().toISOString()
			};
			const item = new AreaInstalledItemTreeItem(installedItem, vscode.Uri.file('/home/test/.copilot/agents/my-agent.agent.md'), 'agents', true);

			assert.strictEqual(buildItemPathReference(item), '~/.copilot/agents/my-agent.agent.md');
		});

		test('returns the logical path for nested files inside an installed area folder', () => {
			const installedItem: InstalledSkill = {
				name: 'my-plugin',
				description: 'Test plugin',
				location: '~/.copilot/plugins/my-plugin',
				installedAt: new Date().toISOString()
			};
			const root = new AreaInstalledItemTreeItem(installedItem, vscode.Uri.file('/home/test/.copilot/plugins/my-plugin'), 'plugins', false);
			const folder = new AreaItemFolderTreeItem(vscode.Uri.file('/home/test/.copilot/plugins/my-plugin/agents'), 'agents', root);
			const file = new AreaItemFileTreeItem(vscode.Uri.file('/home/test/.copilot/plugins/my-plugin/agents/helper.agent.md'), 'helper.agent.md', folder);

			assert.strictEqual(buildItemPathReference(folder), '~/.copilot/plugins/my-plugin/agents');
			assert.strictEqual(buildItemPathReference(file), '~/.copilot/plugins/my-plugin/agents/helper.agent.md');
		});
	});

	suite('SkillPathService.resolveInstallTarget path traversal validation', () => {
		class TestSkillPathService extends SkillPathService {
			override getInstallLocation(): string {
				return '.github/skills';
			}

			override getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
				return {
					uri: vscode.Uri.file('/workspace'),
					name: 'test-workspace',
					index: 0
				};
			}

			override getHomeDirectory(): string {
				return '/home/user';
			}
		}

		test('allows a normal skill name', () => {
			const service = new TestSkillPathService();
			const result = service.resolveInstallTarget('my-skill');
			assert.ok(result, 'Expected a URI for a normal skill name');
			assert.ok(result!.fsPath.endsWith('my-skill'), 'Path should end with the skill name');
		});

		test('rejects skill name containing forward slash', () => {
			const service = new TestSkillPathService();
			const result = service.resolveInstallTarget('evil/skill');
			assert.strictEqual(result, undefined, 'Expected undefined for skill name with forward slash');
		});

		test('rejects skill name containing backslash', () => {
			const service = new TestSkillPathService();
			const result = service.resolveInstallTarget('evil\\skill');
			assert.strictEqual(result, undefined, 'Expected undefined for skill name with backslash');
		});

		test('rejects skill name that is dot-dot', () => {
			const service = new TestSkillPathService();
			const result = service.resolveInstallTarget('..');
			assert.strictEqual(result, undefined, 'Expected undefined for dot-dot skill name');
		});

		test('rejects skill name containing dot-dot as substring', () => {
			const service = new TestSkillPathService();
			const result = service.resolveInstallTarget('..evil');
			assert.strictEqual(result, undefined, 'Expected undefined for skill name containing dot-dot');
		});

		test('rejects empty skill name', () => {
			const service = new TestSkillPathService();
			const result = service.resolveInstallTarget('');
			assert.strictEqual(result, undefined, 'Expected undefined for empty skill name');
		});

		test('rejects single dot skill name', () => {
			const service = new TestSkillPathService();
			const result = service.resolveInstallTarget('.');
			assert.strictEqual(result, undefined, 'Expected undefined for single dot skill name');
		});

		test('rejects whitespace-only skill name', () => {
			const service = new TestSkillPathService();
			const result = service.resolveInstallTarget('   ');
			assert.strictEqual(result, undefined, 'Expected undefined for whitespace-only skill name');
		});

		test('trims whitespace from valid skill name', () => {
			const service = new TestSkillPathService();
			const result = service.resolveInstallTarget('  my-skill  ');
			assert.ok(result, 'Expected a URI for a padded skill name');
			assert.ok(result!.fsPath.endsWith('my-skill'), 'Path should end with the trimmed skill name');
		});
	});

	suite('SkillPathService.resolveLocationToUri whitespace trimming', () => {
		class TrimTestSkillPathService extends SkillPathService {
			override getHomeDirectory(): string {
				return '/home/user';
			}

			override getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
				return {
					uri: vscode.Uri.file('/workspace'),
					name: 'test-workspace',
					index: 0
				};
			}
		}

		test('resolves home location with leading whitespace correctly', () => {
			const service = new TrimTestSkillPathService();
			const result = service.resolveLocationToUri(' ~/.copilot/skills');
			assert.ok(result, 'Expected a URI for padded home location');
			assert.ok(!result!.fsPath.includes('~'), 'Path should not contain literal tilde');
			assert.ok(result!.fsPath.includes('.copilot'), 'Path should include .copilot segment');
		});

		test('resolves home location with trailing whitespace correctly', () => {
			const service = new TrimTestSkillPathService();
			const result = service.resolveLocationToUri('~/.copilot/skills ');
			assert.ok(result, 'Expected a URI for trailing-padded home location');
			assert.ok(!result!.fsPath.includes('~'), 'Path should not contain literal tilde');
		});

		test('isHomeLocation detects tilde with surrounding whitespace', () => {
			const service = new TrimTestSkillPathService();
			assert.strictEqual(service.isHomeLocation(' ~/.copilot/skills'), true);
			assert.strictEqual(service.isHomeLocation('~/.copilot/skills '), true);
			assert.strictEqual(service.isHomeLocation('  ~  '), true);
		});
	});

	test('scanInstalledSkills expands ~ paths and skips missing directories before readDirectory', async () => {
		const workspaceRoot = path.join(os.tmpdir(), 'agent-organizer-test-workspace');
		const workspaceUri = vscode.Uri.file(workspaceRoot);
		const homeDir = os.homedir();
		const normalizePath = (value: string) => path.normalize(value).replace(/[\\/]+$/, '').toLowerCase();

		const existingDirectories = new Set<string>([
			normalizePath(path.join(workspaceRoot, '.github', 'skills')),
			normalizePath(path.join(homeDir, '.copilot', 'skills'))
		]);

		const readDirectoryCalls: string[] = [];
		let missingDirReadAttempts = 0;

		const mockFs: vscode.FileSystem = {
			isWritableFileSystem: () => true,
			stat: async (uri: vscode.Uri) => {
				if (existingDirectories.has(normalizePath(uri.fsPath))) {
					return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
				}

				throw vscode.FileSystemError.FileNotFound(uri);
			},
			readDirectory: async (uri: vscode.Uri) => {
				readDirectoryCalls.push(uri.fsPath);
				const normalizedUriPath = normalizePath(uri.fsPath);

				if (normalizedUriPath === normalizePath(path.join(homeDir, '.claude', 'skills'))) {
					missingDirReadAttempts += 1;
				}

				if (normalizedUriPath === normalizePath(path.join(homeDir, '.copilot', 'skills'))) {
					return [['my-skill', vscode.FileType.Directory]];
				}

				if (normalizedUriPath === normalizePath(path.join(workspaceRoot, '.github', 'skills'))) {
					return [];
				}

				throw vscode.FileSystemError.FileNotFound(uri);
			},
			readFile: async (uri: vscode.Uri) => {
				if (normalizePath(uri.fsPath) === normalizePath(path.join(homeDir, '.copilot', 'skills', 'my-skill', 'SKILL.md'))) {
					const encoder = new TextEncoder();
					return encoder.encode('---\nname: Copilot Skill\ndescription: Test skill\n---\n');
				}

				throw vscode.FileSystemError.FileNotFound(uri);
			},
			createDirectory: async () => undefined,
			writeFile: async () => undefined,
			delete: async () => undefined,
			rename: async () => undefined,
			copy: async () => undefined
		};

		class TestSkillPathService extends SkillPathService {
			override getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
				return {
					uri: workspaceUri,
					name: 'test-workspace',
					index: 0
				};
			}

			override getFileSystem(): vscode.FileSystem {
				return mockFs;
			}

			override getHomeDirectory(): string {
				return homeDir;
			}
		}

		const pathService = new TestSkillPathService();
		const mockContext = {
			workspaceState: {
				get: () => [],
				update: async () => undefined,
				keys: () => []
			},
			subscriptions: []
		} as unknown as vscode.ExtensionContext;
		const provider = new InstalledSkillsTreeDataProvider(mockContext, pathService);
		const skills = await provider.scanInstalledSkills();

		assert.strictEqual(missingDirReadAttempts, 0, 'Missing directories should be skipped before readDirectory');
		assert.ok(
			readDirectoryCalls.some(call => normalizePath(call) === normalizePath(path.join(homeDir, '.copilot', 'skills'))),
			'Expected expanded home directory path to be scanned'
		);
		assert.strictEqual(skills.length, 1);
		assert.strictEqual(skills[0].name, 'Copilot Skill');
		assert.strictEqual(skills[0].location, '~/.copilot/skills/my-skill');
	});

	suite('Installed Skills - Copy To / Move To', () => {
		// Helper: create a real temp skill directory with a SKILL.md
		async function createTempSkill(baseDir: string, skillName: string): Promise<void> {
			const skillDir = vscode.Uri.file(path.join(baseDir, skillName));
			await vscode.workspace.fs.createDirectory(skillDir);
			const skillMd = vscode.Uri.joinPath(skillDir, 'SKILL.md');
			await vscode.workspace.fs.writeFile(skillMd, new TextEncoder().encode(
				`---\nname: ${skillName}\ndescription: Test skill\n---\nBody content\n`
			));
		}

		test('copySkill copies to target location and keeps source', async () => {
			const tmpBase = path.join(os.tmpdir(), `agent-organizer-copy-test-${Date.now()}`);
			const sourceBase = path.join(tmpBase, 'source-skills');
			const targetBase = path.join(tmpBase, 'target-skills');

			await createTempSkill(sourceBase, 'my-skill');
			// Create target base dir
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(targetBase));

			class TestPathService extends SkillPathService {
				override getScanLocations(): string[] { return [sourceBase, targetBase]; }
				override getHomeDirectory(): string { return os.tmpdir(); }
				override isHomeLocation(_location: string): boolean { return false; }
				override requiresWorkspaceFolder(_location: string): boolean { return false; }
				override getWorkspaceFolderForLocation(_location: string): vscode.WorkspaceFolder | undefined { return undefined; }
				override resolveLocationToUri(location: string): vscode.Uri | undefined {
					return vscode.Uri.file(location);
				}
			}

			const service = new SkillInstallationService(
				{} as GitHubSkillsClient, {} as vscode.ExtensionContext, new TestPathService()
			);

			const skill: InstalledSkill = {
				name: 'my-skill', description: 'Test',
				location: `${sourceBase}/my-skill`, installedAt: new Date().toISOString()
			};

			const orig = vscode.window.showQuickPick;
			(vscode.window as any).showQuickPick = async (items: any[]) =>
				items.find((i: any) => i.label === targetBase);

			try {
				const result = await service.copySkill(skill);
				assert.strictEqual(result, true, 'copySkill should succeed');

				// Target should exist
				const targetSkillMd = vscode.Uri.file(path.join(targetBase, 'my-skill', 'SKILL.md'));
				const stat = await vscode.workspace.fs.stat(targetSkillMd);
				assert.ok(stat, 'Copied SKILL.md should exist at target');

				// Source should still exist
				const sourceSkillMd = vscode.Uri.file(path.join(sourceBase, 'my-skill', 'SKILL.md'));
				const srcStat = await vscode.workspace.fs.stat(sourceSkillMd);
				assert.ok(srcStat, 'Source SKILL.md should still exist after copy');
			} finally {
				(vscode.window as any).showQuickPick = orig;
				await vscode.workspace.fs.delete(vscode.Uri.file(tmpBase), { recursive: true });
			}
		});

		test('moveSkill copies to target and deletes source', async () => {
			const tmpBase = path.join(os.tmpdir(), `agent-organizer-move-test-${Date.now()}`);
			const sourceBase = path.join(tmpBase, 'source-skills');
			const targetBase = path.join(tmpBase, 'target-skills');

			await createTempSkill(sourceBase, 'my-skill');
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(targetBase));

			class TestPathService extends SkillPathService {
				override getScanLocations(): string[] { return [sourceBase, targetBase]; }
				override getHomeDirectory(): string { return os.tmpdir(); }
				override isHomeLocation(_location: string): boolean { return false; }
				override requiresWorkspaceFolder(_location: string): boolean { return false; }
				override getWorkspaceFolderForLocation(_location: string): vscode.WorkspaceFolder | undefined { return undefined; }
				override resolveLocationToUri(location: string): vscode.Uri | undefined {
					return vscode.Uri.file(location);
				}
			}

			const service = new SkillInstallationService(
				{} as GitHubSkillsClient, {} as vscode.ExtensionContext, new TestPathService()
			);

			const skill: InstalledSkill = {
				name: 'my-skill', description: 'Test',
				location: `${sourceBase}/my-skill`, installedAt: new Date().toISOString()
			};

			const orig = vscode.window.showQuickPick;
			(vscode.window as any).showQuickPick = async (items: any[]) =>
				items.find((i: any) => i.label === targetBase);

			try {
				const result = await service.moveSkill(skill);
				assert.strictEqual(result, true, 'moveSkill should succeed');

				// Target should exist
				const targetSkillMd = vscode.Uri.file(path.join(targetBase, 'my-skill', 'SKILL.md'));
				const stat = await vscode.workspace.fs.stat(targetSkillMd);
				assert.ok(stat, 'Moved SKILL.md should exist at target');

				// Source should be gone
				let sourceExists = true;
				try {
					await vscode.workspace.fs.stat(vscode.Uri.file(path.join(sourceBase, 'my-skill')));
				} catch {
					sourceExists = false;
				}
				assert.strictEqual(sourceExists, false, 'Source should be deleted after move');
			} finally {
				(vscode.window as any).showQuickPick = orig;
				await vscode.workspace.fs.delete(vscode.Uri.file(tmpBase), { recursive: true });
			}
		});
	});

	suite('Marketplace - Add / Remove Repository', () => {
		const testRepo: SkillRepository = {
			owner: 'test-owner',
			repo: 'test-repo',
			branch: 'main'
		};

		const testSkill: Skill = {
			name: 'test-skill',
			description: 'A test skill',
			source: testRepo,
			skillPath: 'skills/test-skill',
			area: 'skills'
		};

		test('addRepoToMarketplace adds skills from the repository', async () => {
			// Create a mock GitHubSkillsClient that returns a known skill
			const mockClient = {
				discoverAreas: async () => ({ skills: 'skills' }),
				fetchRepoContent: async () => ({ skills: [testSkill], fileItems: [] }),
				clearCache: () => {}
			} as unknown as GitHubSkillsClient;

			const mockContext = {
				extensionUri: undefined
			} as unknown as vscode.ExtensionContext;

			const provider = new MarketplaceTreeDataProvider(mockClient, mockContext);

			assert.strictEqual(provider.getSkills().length, 0, 'Should start with no skills');

			await provider.addRepoToMarketplace(testRepo);

			assert.strictEqual(provider.getSkills().length, 1, 'Should have one skill after add');
			assert.strictEqual(provider.getSkills()[0].name, 'test-skill');
		});

		test('removeRepoFromMarketplace removes only skills from that repository', async () => {
			const otherRepo: SkillRepository = {
				owner: 'other-owner',
				repo: 'other-repo',
				branch: 'main'
			};

			const otherSkill: Skill = {
				name: 'other-skill',
				description: 'Another skill',
				source: otherRepo,
				skillPath: 'skills/other-skill',
				area: 'skills'
			};

			// Add skills from two repos, then remove one
			const mockClient = {
				discoverAreas: async () => ({ skills: 'skills' }),
				fetchRepoContent: async (_repo: SkillRepository, _areas: Record<string, string>) => {
					if (_repo.owner === 'test-owner') { return { skills: [testSkill], fileItems: [] }; }
					return { skills: [otherSkill], fileItems: [] };
				},
				clearCache: () => {}
			} as unknown as GitHubSkillsClient;

			const mockContext = {
				extensionUri: undefined
			} as unknown as vscode.ExtensionContext;

			const provider = new MarketplaceTreeDataProvider(mockClient, mockContext);

			await provider.addRepoToMarketplace(testRepo);
			await provider.addRepoToMarketplace(otherRepo);
			assert.strictEqual(provider.getSkills().length, 2, 'Should have two skills');

			provider.removeRepoFromMarketplace(testRepo);

			assert.strictEqual(provider.getSkills().length, 1, 'Should have one skill after remove');
			assert.strictEqual(provider.getSkills()[0].name, 'other-skill', 'Remaining skill should be from other repo');
		});
	});

	suite('Skill File and Folder Operations', () => {
		test('add and delete a file inside a skill folder', async () => {
			const tmpBase = path.join(os.tmpdir(), `agent-organizer-file-test-${Date.now()}`);
			const skillDir = vscode.Uri.file(path.join(tmpBase, 'my-skill'));
			await vscode.workspace.fs.createDirectory(skillDir);

			try {
				// Add file
				const fileUri = vscode.Uri.joinPath(skillDir, 'notes.txt');
				await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
				const stat = await vscode.workspace.fs.stat(fileUri);
				assert.ok(stat, 'Created file should exist');

				// Delete file
				await vscode.workspace.fs.delete(fileUri);
				let exists = true;
				try { await vscode.workspace.fs.stat(fileUri); } catch { exists = false; }
				assert.strictEqual(exists, false, 'Deleted file should not exist');
			} finally {
				await vscode.workspace.fs.delete(vscode.Uri.file(tmpBase), { recursive: true });
			}
		});

		test('add and delete a folder inside a skill folder', async () => {
			const tmpBase = path.join(os.tmpdir(), `agent-organizer-folder-test-${Date.now()}`);
			const skillDir = vscode.Uri.file(path.join(tmpBase, 'my-skill'));
			await vscode.workspace.fs.createDirectory(skillDir);

			try {
				// Add folder
				const folderUri = vscode.Uri.joinPath(skillDir, 'sub-folder');
				await vscode.workspace.fs.createDirectory(folderUri);
				const stat = await vscode.workspace.fs.stat(folderUri);
				assert.strictEqual(stat.type & vscode.FileType.Directory, vscode.FileType.Directory, 'Created folder should be a directory');

				// Delete folder
				await vscode.workspace.fs.delete(folderUri, { recursive: true });
				let exists = true;
				try { await vscode.workspace.fs.stat(folderUri); } catch { exists = false; }
				assert.strictEqual(exists, false, 'Deleted folder should not exist');
			} finally {
				await vscode.workspace.fs.delete(vscode.Uri.file(tmpBase), { recursive: true });
			}
		});
	});

	suite('parseGitHubUrl', () => {
		// --- Valid URLs ---

		test('parses bare owner/repo URL', () => {
			const result = parseGitHubUrl('https://github.com/owner/repo');
			assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo', branch: undefined });
		});

		test('parses owner/repo with trailing slash', () => {
			const result = parseGitHubUrl('https://github.com/owner/repo/');
			assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo', branch: undefined });
		});

		test('strips .git suffix from repo name', () => {
			const result = parseGitHubUrl('https://github.com/owner/repo.git');
			assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo', branch: undefined });
		});

		test('parses /tree/branch URL', () => {
			const result = parseGitHubUrl('https://github.com/owner/repo/tree/main');
			assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo', branch: 'main' });
		});

		test('parses /tree/branch/path URL', () => {
			const result = parseGitHubUrl('https://github.com/owner/repo/tree/main/skills');
			assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo', branch: 'main' });
		});

		test('parses /tree/branch with deep path', () => {
			const result = parseGitHubUrl('https://github.com/owner/repo/tree/develop/path/to/skills');
			assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo', branch: 'develop' });
		});

		test('strips query string and fragment', () => {
			const result = parseGitHubUrl('https://github.com/owner/repo?tab=readme#section');
			assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo', branch: undefined });
		});

		test('handles http:// protocol', () => {
			const result = parseGitHubUrl('http://github.com/owner/repo');
			assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo', branch: undefined });
		});

		test('handles www. prefix', () => {
			const result = parseGitHubUrl('https://www.github.com/owner/repo');
			assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo', branch: undefined });
		});

		test('trims whitespace', () => {
			const result = parseGitHubUrl('  https://github.com/owner/repo  ');
			assert.deepStrictEqual(result, { owner: 'owner', repo: 'repo', branch: undefined });
		});

		// --- Invalid URLs ---

		test('rejects non-GitHub host', () => {
			assert.strictEqual(parseGitHubUrl('https://gitlab.com/owner/repo'), undefined);
		});

		test('rejects URL with only owner (no repo)', () => {
			assert.strictEqual(parseGitHubUrl('https://github.com/owner'), undefined);
		});

		test('rejects /blob/ URLs', () => {
			assert.strictEqual(parseGitHubUrl('https://github.com/owner/repo/blob/main/README.md'), undefined);
		});

		test('rejects /issues/ URLs', () => {
			assert.strictEqual(parseGitHubUrl('https://github.com/owner/repo/issues/123'), undefined);
		});

		test('rejects /tree/ without branch segment', () => {
			assert.strictEqual(parseGitHubUrl('https://github.com/owner/repo/tree'), undefined);
		});

		test('rejects empty string', () => {
			assert.strictEqual(parseGitHubUrl(''), undefined);
		});

		test('rejects random non-URL string', () => {
			assert.strictEqual(parseGitHubUrl('not a url at all'), undefined);
		});
	});
});
