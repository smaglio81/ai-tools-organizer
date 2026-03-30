/**
 * Mock filesystem data for testing InstalledAreaTreeDataProvider.
 *
 * Simulates the directory structures and file contents that the area views
 * would find on disk when scanning for installed items.
 *
 * The mock covers all 7 active content areas:
 *   - agents (singleFile, *.agent.md)
 *   - hooksGithub (multiFile, hooks.json)
 *   - hooksKiro (singleFile, *.json in hooks/)
 *   - instructions (singleFile, *.instructions.md)
 *   - plugins (multiFile, plugin.json)
 *   - prompts (singleFile, *.prompt.md)
 *   - skills (multiFile, SKILL.md)
 *
 * Usage: build a mock vscode.FileSystem using these structures to drive
 * stat(), readDirectory(), and readFile() calls.
 */

import * as vscode from 'vscode';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A file entry with its content (for readFile) */
export interface MockFile {
    type: 'file';
    content: string;
    size?: number;
    /** Modification time (set automatically by MockFileSystem.writeFile) */
    mtime?: number;
}

/** A directory entry with children */
export interface MockDirectory {
    type: 'directory';
    children: Record<string, MockFile | MockDirectory>;
}

export type MockFsNode = MockFile | MockDirectory;

// ─── Helper to build directory entries for readDirectory ─────────────────────

export function mockReadDirectory(node: MockDirectory): [string, vscode.FileType][] {
    return Object.entries(node.children).map(([name, child]) => [
        name,
        child.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File
    ]);
}

// ─── Agents (singleFile: *.agent.md) ─────────────────────────────────────────

/** ~/.copilot/agents/ */
export const MOCK_AGENTS_DIR: MockDirectory = {
    type: 'directory',
    children: {
        'accessibility.agent.md': {
            type: 'file',
            content: '---\nname: accessibility\ndescription: Accessibility review agent\n---\nReview code for accessibility issues.',
        },
        'debug.agent.md': {
            type: 'file',
            content: '---\nname: debug\ndescription: Debug assistant\n---\nHelps debug issues step by step.',
        },
        'subfolder': {
            type: 'directory',
            children: {
                'nested-agent.agent.md': {
                    type: 'file',
                    content: '---\nname: nested-agent\ndescription: Agent in a subfolder\n---\nNested agent content.',
                },
            },
        },
    },
};

// ─── Hooks - GitHub (multiFile: folders with hooks.json) ─────────────────────

/** ~/.copilot/hooks/ */
export const MOCK_HOOKS_GITHUB_DIR: MockDirectory = {
    type: 'directory',
    children: {
        'dependency-license-checker': {
            type: 'directory',
            children: {
                'hooks.json': {
                    type: 'file',
                    content: JSON.stringify({
                        name: 'Dependency License Checker',
                        description: 'Checks dependency licenses before committing',
                        hooks: [{ event: 'preCommit', command: './check-licenses.sh' }]
                    }),
                },
                'README.md': {
                    type: 'file',
                    content: '# Dependency License Checker\nChecks all dependency licenses.',
                },
                'check-licenses.sh': {
                    type: 'file',
                    content: '#!/bin/bash\necho "Checking licenses..."',
                },
            },
        },
        'secrets-scanner': {
            type: 'directory',
            children: {
                'hooks.json': {
                    type: 'file',
                    content: JSON.stringify({
                        name: 'Secrets Scanner',
                        description: 'Scans for leaked secrets in staged files',
                        hooks: [{ event: 'preCommit', command: './scan-secrets.sh' }]
                    }),
                },
                'README.md': {
                    type: 'file',
                    content: '# Secrets Scanner\nScans for secrets in code.',
                },
                'scan-secrets.sh': {
                    type: 'file',
                    content: '#!/bin/bash\necho "Scanning for secrets..."',
                },
            },
        },
    },
};

// ─── Hooks - Kiro (singleFile: *.json in .kiro/hooks/) ──────────────────────

/** .kiro/hooks/ */
export const MOCK_HOOKS_KIRO_DIR: MockDirectory = {
    type: 'directory',
    children: {
        'lint-on-save.json': {
            type: 'file',
            content: JSON.stringify({
                name: 'Lint on Save',
                version: '1.0.0',
                when: { type: 'fileEdited', patterns: ['*.ts'] },
                then: { type: 'runCommand', command: 'npm run lint' }
            }),
        },
        'test-after-task.json': {
            type: 'file',
            content: JSON.stringify({
                name: 'Test After Task',
                version: '1.0.0',
                when: { type: 'postTaskExecution' },
                then: { type: 'runCommand', command: 'npm test' }
            }),
        },
    },
};

// ─── Instructions (singleFile: *.instructions.md) ───────────────────────────

/** ~/.copilot/instructions/ */
export const MOCK_INSTRUCTIONS_DIR: MockDirectory = {
    type: 'directory',
    children: {
        'csharp.instructions.md': {
            type: 'file',
            content: '---\nname: csharp\ndescription: C# coding standards\n---\nFollow C# best practices.',
        },
        'terraform.instructions.md': {
            type: 'file',
            content: '---\nname: terraform\ndescription: Terraform IaC guidelines\n---\nUse modules and remote state.',
        },
    },
};

// ─── Plugins (multiFile: folders with plugin.json, possibly nested) ──────────

/** ~/.copilot/plugins/ */
export const MOCK_PLUGINS_DIR: MockDirectory = {
    type: 'directory',
    children: {
        'automate-this': {
            type: 'directory',
            children: {
                // plugin.json is nested under .github/plugin/
                '.github': {
                    type: 'directory',
                    children: {
                        'plugin': {
                            type: 'directory',
                            children: {
                                'plugin.json': {
                                    type: 'file',
                                    content: JSON.stringify({
                                        name: 'Automate This',
                                        description: 'Automation plugin for repetitive tasks'
                                    }),
                                },
                            },
                        },
                    },
                },
                'README.md': {
                    type: 'file',
                    content: '# Automate This\nAutomates repetitive tasks.',
                },
            },
        },
        'code-review-helper': {
            type: 'directory',
            children: {
                // plugin.json at root level
                'plugin.json': {
                    type: 'file',
                    content: JSON.stringify({
                        name: 'Code Review Helper',
                        description: 'Assists with code review workflows'
                    }),
                },
                'README.md': {
                    type: 'file',
                    content: '# Code Review Helper\nHelps with code reviews.',
                },
            },
        },
    },
};

// ─── Prompts (singleFile: *.prompt.md) ───────────────────────────────────────

/** ~/.copilot/prompts/ */
export const MOCK_PROMPTS_DIR: MockDirectory = {
    type: 'directory',
    children: {
        'explain-code.prompt.md': {
            type: 'file',
            content: '---\nname: explain-code\ndescription: Explain selected code\n---\nExplain the selected code in detail.',
        },
        'write-tests.prompt.md': {
            type: 'file',
            content: '---\nname: write-tests\ndescription: Generate unit tests\n---\nWrite unit tests for the selected code.',
        },
        'refactoring': {
            type: 'directory',
            children: {
                'extract-method.prompt.md': {
                    type: 'file',
                    content: '---\nname: extract-method\ndescription: Extract method refactoring\n---\nExtract the selected code into a method.',
                },
            },
        },
    },
};

// ─── Skills (multiFile: folders with SKILL.md) ──────────────────────────────

/** ~/.copilot/skills/ */
export const MOCK_SKILLS_DIR: MockDirectory = {
    type: 'directory',
    children: {
        'powershell': {
            type: 'directory',
            children: {
                'SKILL.md': {
                    type: 'file',
                    content: '---\nname: powershell\ndescription: PowerShell coding standards for AI\n---\n# PowerShell Skill\nBest practices for PowerShell.',
                },
                'examples': {
                    type: 'directory',
                    children: {
                        'sample.ps1': {
                            type: 'file',
                            content: 'Write-Host "Hello World"',
                        },
                    },
                },
            },
        },
        'dotnet-testing': {
            type: 'directory',
            children: {
                'SKILL.md': {
                    type: 'file',
                    content: '---\nname: dotnet-testing\ndescription: .NET testing best practices\n---\n# .NET Testing\nxUnit patterns and practices.',
                },
            },
        },
    },
};


// ─── Combined filesystem tree (simulates ~/.copilot/) ────────────────────────

/** Full mock of ~/.copilot/ with all area directories */
export const MOCK_COPILOT_HOME: MockDirectory = {
    type: 'directory',
    children: {
        'agents': MOCK_AGENTS_DIR,
        'hooks': MOCK_HOOKS_GITHUB_DIR,
        'instructions': MOCK_INSTRUCTIONS_DIR,
        'plugins': MOCK_PLUGINS_DIR,
        'prompts': MOCK_PROMPTS_DIR,
        'skills': MOCK_SKILLS_DIR,
    },
};

/** Mock of .kiro/ (workspace-relative) */
export const MOCK_KIRO_DIR: MockDirectory = {
    type: 'directory',
    children: {
        'hooks': MOCK_HOOKS_KIRO_DIR,
    },
};

// ─── Expected scan results per area ──────────────────────────────────────────

/** Expected InstalledSkill[] from scanning MOCK_AGENTS_DIR at ~/.copilot/agents */
export const EXPECTED_AGENTS = [
    { name: 'accessibility', description: '', location: '~/.copilot/agents/accessibility.agent.md' },
    { name: 'debug', description: '', location: '~/.copilot/agents/debug.agent.md' },
    { name: 'nested-agent', description: '', location: '~/.copilot/agents/subfolder/nested-agent.agent.md' },
];

/** Expected InstalledSkill[] from scanning MOCK_HOOKS_GITHUB_DIR at ~/.copilot/hooks */
export const EXPECTED_HOOKS_GITHUB = [
    { name: 'Dependency License Checker', description: 'Checks dependency licenses before committing', location: '~/.copilot/hooks/dependency-license-checker' },
    { name: 'Secrets Scanner', description: 'Scans for leaked secrets in staged files', location: '~/.copilot/hooks/secrets-scanner' },
];

/** Expected InstalledSkill[] from scanning MOCK_HOOKS_KIRO_DIR at .kiro/hooks */
export const EXPECTED_HOOKS_KIRO = [
    { name: 'lint-on-save', description: '', location: '.kiro/hooks/lint-on-save.json' },
    { name: 'test-after-task', description: '', location: '.kiro/hooks/test-after-task.json' },
];

/** Expected InstalledSkill[] from scanning MOCK_INSTRUCTIONS_DIR at ~/.copilot/instructions */
export const EXPECTED_INSTRUCTIONS = [
    { name: 'csharp', description: '', location: '~/.copilot/instructions/csharp.instructions.md' },
    { name: 'terraform', description: '', location: '~/.copilot/instructions/terraform.instructions.md' },
];

/** Expected InstalledSkill[] from scanning MOCK_PLUGINS_DIR at ~/.copilot/plugins */
export const EXPECTED_PLUGINS = [
    { name: 'Automate This', description: 'Automation plugin for repetitive tasks', location: '~/.copilot/plugins/automate-this' },
    { name: 'Code Review Helper', description: 'Assists with code review workflows', location: '~/.copilot/plugins/code-review-helper' },
];

/** Expected InstalledSkill[] from scanning MOCK_PROMPTS_DIR at ~/.copilot/prompts */
export const EXPECTED_PROMPTS = [
    { name: 'explain-code', description: '', location: '~/.copilot/prompts/explain-code.prompt.md' },
    { name: 'write-tests', description: '', location: '~/.copilot/prompts/write-tests.prompt.md' },
    { name: 'extract-method', description: '', location: '~/.copilot/prompts/refactoring/extract-method.prompt.md' },
];

/** Expected InstalledSkill[] from scanning MOCK_SKILLS_DIR at ~/.copilot/skills */
export const EXPECTED_SKILLS = [
    { name: 'powershell', description: 'PowerShell coding standards for AI', location: '~/.copilot/skills/powershell' },
    { name: 'dotnet-testing', description: '.NET testing best practices', location: '~/.copilot/skills/dotnet-testing' },
];


// ─── MockFileSystem — full vscode.FileSystem implementation ──────────────────

/**
 * In-memory filesystem that implements vscode.FileSystem.
 * Supports read and write operations for testing install/download flows.
 *
 * Usage:
 *   const mockFs = new MockFileSystem({ 'agents': MOCK_AGENTS_DIR });
 *   // Pass mockFs to a TestSkillPathService that overrides getFileSystem()
 *
 * After an install, assert that the file was written:
 *   const node = mockFs.resolve('/home/user/.copilot/plugins/my-plugin/plugin.json');
 *   assert.ok(node && node.type === 'file');
 *
 * The filesystem is rooted at '/'. Paths are normalized to forward slashes.
 */
export class MockFileSystem implements vscode.FileSystem {
    private root: MockDirectory;
    /** Track all write operations for assertions */
    public readonly writeLog: { path: string; content: Uint8Array }[] = [];
    /** Track all delete operations for assertions */
    public readonly deleteLog: { path: string; recursive: boolean }[] = [];
    /** Track all copy operations for assertions */
    public readonly copyLog: { source: string; target: string }[] = [];
    /** Track all rename operations for assertions */
    public readonly renameLog: { source: string; target: string }[] = [];

    constructor(initialTree?: Record<string, MockFsNode>) {
        this.root = {
            type: 'directory',
            children: initialTree || {}
        };
    }

    // ─── Path helpers ────────────────────────────────────────────────────

    private normalizePath(uri: vscode.Uri): string {
        return uri.fsPath.replace(/\\/g, '/');
    }

    private segments(fsPath: string): string[] {
        return fsPath.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(s => s.length > 0);
    }

    /**
     * Resolve a path to a node in the tree. Returns undefined if not found.
     * Public so tests can inspect the tree after writes.
     */
    resolve(fsPath: string): MockFsNode | undefined {
        const parts = this.segments(fsPath);
        let current: MockFsNode = this.root;
        for (const part of parts) {
            if (current.type !== 'directory') { return undefined; }
            const child: MockFsNode | undefined = current.children[part];
            if (!child) { return undefined; }
            current = child;
        }
        return current;
    }

    /**
     * Resolve the parent directory and the final segment name.
     * Creates intermediate directories if `create` is true.
     */
    private resolveParent(fsPath: string, create: boolean): { parent: MockDirectory; name: string } | undefined {
        const parts = this.segments(fsPath);
        if (parts.length === 0) { return undefined; }
        const name = parts.pop()!;
        let current: MockFsNode = this.root;
        for (const part of parts) {
            if (current.type !== 'directory') { return undefined; }
            let child: MockFsNode | undefined = current.children[part];
            if (!child) {
                if (!create) { return undefined; }
                child = { type: 'directory', children: {} };
                current.children[part] = child;
            }
            current = child;
        }
        if (current.type !== 'directory') { return undefined; }
        return { parent: current, name };
    }

    /**
     * Deep-clone a MockFsNode (used by copy).
     */
    private cloneNode(node: MockFsNode): MockFsNode {
        if (node.type === 'file') {
            return { type: 'file', content: node.content, size: node.size, mtime: node.mtime };
        }
        const children: Record<string, MockFsNode> = {};
        for (const [k, v] of Object.entries(node.children)) {
            children[k] = this.cloneNode(v);
        }
        return { type: 'directory', children };
    }

    // ─── vscode.FileSystem interface ─────────────────────────────────────

    isWritableFileSystem(_scheme: string): boolean | undefined {
        return true;
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const node = this.resolve(this.normalizePath(uri));
        if (!node) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return {
            type: node.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File,
            ctime: 0,
            mtime: node.type === 'file' && node.mtime ? node.mtime : 0,
            size: node.type === 'file' ? (node.size ?? new TextEncoder().encode(node.content).length) : 0
        };
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        const node = this.resolve(this.normalizePath(uri));
        if (!node || node.type !== 'directory') {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return Object.entries(node.children).map(([name, child]) => [
            name,
            child.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File
        ]);
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const node = this.resolve(this.normalizePath(uri));
        if (!node || node.type !== 'file') {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return new TextEncoder().encode(node.content);
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
        const fsPath = this.normalizePath(uri);
        const resolved = this.resolveParent(fsPath, true);
        if (!resolved) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        const decoded = new TextDecoder().decode(content);
        resolved.parent.children[resolved.name] = {
            type: 'file',
            content: decoded,
            size: content.length,
            mtime: Date.now()
        };
        this.writeLog.push({ path: fsPath, content });
    }

    async createDirectory(uri: vscode.Uri): Promise<void> {
        const fsPath = this.normalizePath(uri);
        const resolved = this.resolveParent(fsPath, true);
        if (!resolved) { return; }
        const existing = resolved.parent.children[resolved.name];
        if (!existing || existing.type !== 'directory') {
            resolved.parent.children[resolved.name] = { type: 'directory', children: {} };
        }
    }

    async delete(uri: vscode.Uri, options?: { recursive?: boolean; useTrash?: boolean }): Promise<void> {
        const fsPath = this.normalizePath(uri);
        const resolved = this.resolveParent(fsPath, false);
        if (!resolved || !(resolved.name in resolved.parent.children)) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        delete resolved.parent.children[resolved.name];
        this.deleteLog.push({ path: fsPath, recursive: options?.recursive ?? false });
    }

    async rename(source: vscode.Uri, target: vscode.Uri): Promise<void> {
        const srcPath = this.normalizePath(source);
        const tgtPath = this.normalizePath(target);
        const srcResolved = this.resolveParent(srcPath, false);
        if (!srcResolved || !(srcResolved.name in srcResolved.parent.children)) {
            throw vscode.FileSystemError.FileNotFound(source);
        }
        const node = srcResolved.parent.children[srcResolved.name];
        delete srcResolved.parent.children[srcResolved.name];
        const tgtResolved = this.resolveParent(tgtPath, true);
        if (!tgtResolved) {
            throw vscode.FileSystemError.FileNotFound(target);
        }
        tgtResolved.parent.children[tgtResolved.name] = node;
        this.renameLog.push({ source: srcPath, target: tgtPath });
    }

    async copy(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }): Promise<void> {
        const srcPath = this.normalizePath(source);
        const tgtPath = this.normalizePath(target);
        const srcNode = this.resolve(srcPath);
        if (!srcNode) {
            throw vscode.FileSystemError.FileNotFound(source);
        }
        const tgtResolved = this.resolveParent(tgtPath, true);
        if (!tgtResolved) {
            throw vscode.FileSystemError.FileNotFound(target);
        }
        if (!options?.overwrite && tgtResolved.parent.children[tgtResolved.name]) {
            throw vscode.FileSystemError.FileExists(target);
        }
        tgtResolved.parent.children[tgtResolved.name] = this.cloneNode(srcNode);
        this.copyLog.push({ source: srcPath, target: tgtPath });
    }
}
