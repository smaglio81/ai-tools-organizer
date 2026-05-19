import * as vscode from 'vscode';

/**
 * Delete a file or folder, sending it to the trash when possible.
 *
 * Falls back to permanent deletion when the trash operation fails. This occurs
 * on Windows when the path is inside a junction point (e.g. ~/.copilot/skills
 * created by `ucsb-ai install --folder-mode`): the Windows Shell API aborts
 * Recycle Bin operations for cross-volume junction targets.
 */
export async function deleteWithTrashFallback(
    uri: vscode.Uri,
    options: { recursive?: boolean } = {}
): Promise<void> {
    try {
        await vscode.workspace.fs.delete(uri, { ...options, useTrash: true });
    } catch {
        await vscode.workspace.fs.delete(uri, { ...options, useTrash: false });
    }
}
