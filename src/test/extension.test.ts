import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { InstalledSkillsTreeDataProvider } from '../views/installedProvider';
import { SkillPathService } from '../services/skillPathService';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
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
		const workspaceRoot = path.join(os.tmpdir(), 'agent-skills-test-workspace');
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
		const provider = new InstalledSkillsTreeDataProvider({} as vscode.ExtensionContext, pathService);
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
});
