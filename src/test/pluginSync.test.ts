/**
 * Plugin Sync Test Suite
 *
 * Tests the three levels of "Get latest copy" into plugin subfolders,
 * and "Copy to area" from plugin subfolders back to installed areas.
 */

import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { InstalledSkill } from '../types';
import {
    syncPluginItem,
    findLatestCopy,
    PLUGIN_SUBFOLDER_TO_AREA,
    PLUGIN_AREA_SUBFOLDERS,
    SyncResult,
} from '../services/pluginSyncService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createTempPluginStructure() {
    const base = path.join(os.tmpdir(), `ao-plugin-test-${Date.now()}`);
    const pluginDir = path.join(base, 'my-plugin');
    const skillsArea = path.join(base, 'skills-area');
    const agentsArea = path.join(base, 'agents-area');

    // Plugin: skills/old-skill/SKILL.md
    const ps = path.join(pluginDir, 'skills', 'old-skill');
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(ps));
    await vscode.workspace.fs.writeFile(
        vscode.Uri.file(path.join(ps, 'SKILL.md')),
        new TextEncoder().encode('---\nname: old-skill\n---\nOld plugin content.')
    );
    // Plugin: agents/old-agent.agent.md
    const pa = path.join(pluginDir, 'agents');
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(pa));
    await vscode.workspace.fs.writeFile(
        vscode.Uri.file(path.join(pa, 'old-agent.agent.md')),
        new TextEncoder().encode('---\nname: old-agent\n---\nOld plugin agent.')
    );
    // Area: skills-area/old-skill/SKILL.md (the "latest" version)
    const as1 = path.join(skillsArea, 'old-skill');
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(as1));
    await vscode.workspace.fs.writeFile(
        vscode.Uri.file(path.join(as1, 'SKILL.md')),
        new TextEncoder().encode('---\nname: old-skill\n---\nNew area content.')
    );
    // Area: agents-area/old-agent.agent.md (the "latest" version)
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(agentsArea));
    await vscode.workspace.fs.writeFile(
        vscode.Uri.file(path.join(agentsArea, 'old-agent.agent.md')),
        new TextEncoder().encode('---\nname: old-agent\n---\nNew area agent.')
    );
    return { base, pluginDir, skillsArea, agentsArea };
}

async function cleanup(base: string) {
    await vscode.workspace.fs.delete(vscode.Uri.file(base), { recursive: true });
}

suite('Plugin Sync Test Suite', () => {

    suite('findLatestCopy', () => {
        const items: InstalledSkill[] = [
            { name: 'a', description: '', location: '/a', installedAt: '' },
            { name: 'b', description: '', location: '/b', installedAt: '' },
        ];
        test('finds match', () => {
            assert.strictEqual(findLatestCopy('a', items)!.name, 'a');
        });
        test('returns undefined for no match', () => {
            assert.strictEqual(findLatestCopy('z', items), undefined);
        });
    });

    suite('Single item sync', () => {
        test('syncs a skill folder from area to plugin', async () => {
            const t = await createTempPluginStructure();
            try {
                const itemUri = vscode.Uri.file(path.join(t.pluginDir, 'skills', 'old-skill'));
                const items: InstalledSkill[] = [
                    { name: 'old-skill', description: '', location: t.skillsArea + '/old-skill', installedAt: '' }
                ];
                const r = await syncPluginItem(itemUri, 'old-skill', items, i => vscode.Uri.file(i.location));
                assert.strictEqual(r.updated, true);
                const c = new TextDecoder().decode(await vscode.workspace.fs.readFile(
                    vscode.Uri.file(path.join(t.pluginDir, 'skills', 'old-skill', 'SKILL.md'))
                ));
                assert.ok(c.includes('New area content'));
            } finally { await cleanup(t.base); }
        });

        test('syncs a single-file agent from area to plugin', async () => {
            const t = await createTempPluginStructure();
            try {
                const itemUri = vscode.Uri.file(path.join(t.pluginDir, 'agents', 'old-agent.agent.md'));
                const items: InstalledSkill[] = [
                    { name: 'old-agent', description: '', location: t.agentsArea + '/old-agent.agent.md', installedAt: '' }
                ];
                const r = await syncPluginItem(itemUri, 'old-agent', items, i => vscode.Uri.file(i.location));
                assert.strictEqual(r.updated, true);
                const c = new TextDecoder().decode(await vscode.workspace.fs.readFile(
                    vscode.Uri.file(path.join(t.pluginDir, 'agents', 'old-agent.agent.md'))
                ));
                assert.ok(c.includes('New area agent'));
            } finally { await cleanup(t.base); }
        });

        test('returns reason when not found', async () => {
            const r = await syncPluginItem(vscode.Uri.file('/tmp/x'), 'missing', [], () => undefined);
            assert.strictEqual(r.updated, false);
            assert.strictEqual(r.reason, 'no matching item found');
        });

        test('returns reason when URI unresolvable', async () => {
            const items: InstalledSkill[] = [{ name: 'x', description: '', location: '/x', installedAt: '' }];
            const r = await syncPluginItem(vscode.Uri.file('/tmp/x'), 'x', items, () => undefined);
            assert.strictEqual(r.updated, false);
            assert.strictEqual(r.reason, 'could not resolve source location');
        });
    });

    suite('Folder sync', () => {
        test('syncs all items in a plugin skills subfolder', async () => {
            const t = await createTempPluginStructure();
            try {
                const dir = vscode.Uri.file(path.join(t.pluginDir, 'skills'));
                const items: InstalledSkill[] = [
                    { name: 'old-skill', description: '', location: t.skillsArea + '/old-skill', installedAt: '' }
                ];
                const entries = await vscode.workspace.fs.readDirectory(dir);
                const results: SyncResult[] = [];
                for (const [name] of entries) {
                    results.push(await syncPluginItem(
                        vscode.Uri.joinPath(dir, name), name, items, i => vscode.Uri.file(i.location)
                    ));
                }
                assert.strictEqual(results.length, 1);
                assert.strictEqual(results[0].updated, true);
            } finally { await cleanup(t.base); }
        });

        test('mixed results when some items have no match', async () => {
            const t = await createTempPluginStructure();
            try {
                // Add orphan
                const orphan = path.join(t.pluginDir, 'skills', 'orphan');
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(orphan));
                await vscode.workspace.fs.writeFile(
                    vscode.Uri.file(path.join(orphan, 'SKILL.md')),
                    new TextEncoder().encode('orphan')
                );
                const dir = vscode.Uri.file(path.join(t.pluginDir, 'skills'));
                const items: InstalledSkill[] = [
                    { name: 'old-skill', description: '', location: t.skillsArea + '/old-skill', installedAt: '' }
                ];
                const entries = await vscode.workspace.fs.readDirectory(dir);
                const results: (SyncResult & { name: string })[] = [];
                for (const [name] of entries) {
                    results.push({ name, ...await syncPluginItem(
                        vscode.Uri.joinPath(dir, name), name, items, i => vscode.Uri.file(i.location)
                    )});
                }
                assert.strictEqual(results.length, 2);
                assert.strictEqual(results.filter(r => r.updated).length, 1);
                assert.strictEqual(results.filter(r => !r.updated).length, 1);
                assert.strictEqual(results.find(r => !r.updated)!.reason, 'no matching item found');
            } finally { await cleanup(t.base); }
        });
    });

    suite('Full plugin sync', () => {
        test('syncs all area subfolders', async () => {
            const t = await createTempPluginStructure();
            try {
                const pluginUri = vscode.Uri.file(t.pluginDir);
                const all: { area: string; updated: boolean }[] = [];
                for (const sub of PLUGIN_AREA_SUBFOLDERS) {
                    const subUri = vscode.Uri.joinPath(pluginUri, sub);
                    let entries: [string, vscode.FileType][];
                    try { entries = await vscode.workspace.fs.readDirectory(subUri); } catch { continue; }
                    const area = PLUGIN_SUBFOLDER_TO_AREA[sub];
                    const src: InstalledSkill[] = area === 'skills'
                        ? [{ name: 'old-skill', description: '', location: t.skillsArea + '/old-skill', installedAt: '' }]
                        : area === 'agents'
                        ? [{ name: 'old-agent', description: '', location: t.agentsArea + '/old-agent.agent.md', installedAt: '' }]
                        : [];
                    for (const [name] of entries) {
                        const n = name.endsWith('.agent.md') ? name.slice(0, -'.agent.md'.length) : name;
                        const r = await syncPluginItem(vscode.Uri.joinPath(subUri, name), n, src, i => vscode.Uri.file(i.location));
                        all.push({ area: sub, ...r });
                    }
                }
                assert.strictEqual(all.length, 2);
                assert.ok(all.every(r => r.updated));
            } finally { await cleanup(t.base); }
        });
    });

    suite('Copy from plugin to area', () => {
        test('copies a skill folder from plugin to target', async () => {
            const t = await createTempPluginStructure();
            try {
                const src = vscode.Uri.file(path.join(t.pluginDir, 'skills', 'old-skill'));
                const tgt = vscode.Uri.file(path.join(t.base, 'target', 'old-skill'));
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(t.base, 'target')));
                await vscode.workspace.fs.copy(src, tgt);
                const c = new TextDecoder().decode(await vscode.workspace.fs.readFile(
                    vscode.Uri.file(path.join(t.base, 'target', 'old-skill', 'SKILL.md'))
                ));
                assert.ok(c.includes('Old plugin content'));
            } finally { await cleanup(t.base); }
        });

        test('copies a single-file agent from plugin to target', async () => {
            const t = await createTempPluginStructure();
            try {
                const src = vscode.Uri.file(path.join(t.pluginDir, 'agents', 'old-agent.agent.md'));
                const tgt = vscode.Uri.file(path.join(t.base, 'target', 'old-agent.agent.md'));
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(t.base, 'target')));
                await vscode.workspace.fs.copy(src, tgt);
                const c = new TextDecoder().decode(await vscode.workspace.fs.readFile(tgt));
                assert.ok(c.includes('Old plugin agent'));
            } finally { await cleanup(t.base); }
        });
    });

    suite('Mappings', () => {
        test('PLUGIN_SUBFOLDER_TO_AREA maps all four', () => {
            assert.strictEqual(PLUGIN_SUBFOLDER_TO_AREA['agents'], 'agents');
            assert.strictEqual(PLUGIN_SUBFOLDER_TO_AREA['skills'], 'skills');
            assert.strictEqual(PLUGIN_SUBFOLDER_TO_AREA['commands'], 'prompts');
            assert.strictEqual(PLUGIN_SUBFOLDER_TO_AREA['hooks'], 'hooksGithub');
        });
        test('PLUGIN_AREA_SUBFOLDERS has all four', () => {
            assert.deepStrictEqual(PLUGIN_AREA_SUBFOLDERS.sort(), ['agents', 'commands', 'hooks', 'skills']);
        });
    });
});
