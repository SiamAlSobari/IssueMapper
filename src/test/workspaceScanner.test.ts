import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceFiles, getGitContext } from '../utils/workspaceScanner';

suite('Workspace Scanner Test Suite', () => {
	let rootPath: string | undefined;

	suiteSetup(() => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			rootPath = workspaceFolders[0].uri.fsPath;
		}
	});

	test('getWorkspaceFiles should scan files and apply default/custom ignore patterns', async () => {
		if (!rootPath) {
			assert.fail('Workspace root path not available');
		}

		// 1. Create a temporary file that should be included
		const tempFilePath = path.join(rootPath, 'temp-test-file-to-include.txt');
		fs.writeFileSync(tempFilePath, 'hello world', 'utf8');

		// 2. Create a temporary file that matches custom ignore pattern
		const tempIgnoreFilePath = path.join(rootPath, 'temp-test-file-to-exclude.abc');
		fs.writeFileSync(tempIgnoreFilePath, 'ignored content', 'utf8');

		try {
			// Get workspace files with custom ignore patterns
			const files = await getWorkspaceFiles(['**/*.abc']);
			
			// Verify 'temp-test-file-to-include.txt' is included
			const includeName = 'temp-test-file-to-include.txt';
			const hasInclude = files.some(f => f.endsWith(includeName));
			assert.ok(hasInclude, `Expected workspace files to contain ${includeName}`);

			// Verify 'temp-test-file-to-exclude.abc' is excluded
			const excludeName = 'temp-test-file-to-exclude.abc';
			const hasExclude = files.some(f => f.endsWith(excludeName));
			assert.ok(!hasExclude, `Expected workspace files to NOT contain ${excludeName}`);

		} finally {
			// Clean up files
			if (fs.existsSync(tempFilePath)) {
				fs.unlinkSync(tempFilePath);
			}
			if (fs.existsSync(tempIgnoreFilePath)) {
				fs.unlinkSync(tempIgnoreFilePath);
			}
		}
	});

	test('getGitContext should return branch and recent commits in a git repository', async () => {
		const context = await getGitContext();
		
		// In active git repository, activeBranch should not be empty
		assert.ok(typeof context.activeBranch === 'string', 'activeBranch should be a string');
		assert.ok(Array.isArray(context.unstagedFiles), 'unstagedFiles should be an array');
		assert.ok(Array.isArray(context.recentCommits), 'recentCommits should be an array');
	});
});
