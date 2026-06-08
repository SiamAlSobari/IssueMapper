import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
	cosineSimilarity,
	TFIDFSearch,
	WorkspaceSemanticIndexer,
	IndexedFile
} from '../utils/embedding';

suite('Semantic Search & TF-IDF Test Suite', () => {
	let rootPath: string | undefined;

	suiteSetup(() => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			rootPath = workspaceFolders[0].uri.fsPath;
		}
	});

	test('cosineSimilarity should calculate similarity correctly', () => {
		const vecA = [1, 0, 0];
		const vecB = [1, 0, 0];
		assert.strictEqual(cosineSimilarity(vecA, vecB), 1);

		const vecC = [0, 1, 0];
		assert.strictEqual(cosineSimilarity(vecA, vecC), 0);

		const vecD = [1, 1, 0]; // angle is 45 degrees, similarity is 1/sqrt(2) = 0.7071...
		assert.ok(Math.abs(cosineSimilarity(vecA, vecD) - 0.7071) < 0.01);
	});

	test('TFIDFSearch.tokenize should tokenize and filter stopwords correctly', () => {
		const text = 'This is a test function handleTokenRefresh() with some code.';
		const tokens = TFIDFSearch.tokenize(text);
		
		// Stopwords like 'this', 'is', 'a', 'with', 'some' should be removed
		assert.ok(!tokens.includes('this'));
		assert.ok(!tokens.includes('is'));
		assert.ok(!tokens.includes('a'));

		// camelCase split should break handleTokenRefresh into handle, token, refresh
		assert.ok(tokens.includes('handle'));
		assert.ok(tokens.includes('token'));
		assert.ok(tokens.includes('refresh'));
		assert.ok(tokens.includes('test'));
		assert.ok(tokens.includes('code'));
	});

	test('TFIDFSearch.search should rank files by relevance correctly', () => {
		const indexedFiles: IndexedFile[] = [
			{
				filePath: 'src/utils/auth.ts',
				hash: 'h1',
				tokens: ['auth', 'login', 'token', 'refresh', 'user']
			},
			{
				filePath: 'src/components/Button.tsx',
				hash: 'h2',
				tokens: ['button', 'click', 'style', 'color', 'render']
			},
			{
				filePath: 'src/utils/math.ts',
				hash: 'h3',
				tokens: ['math', 'add', 'subtract', 'calculate', 'sum']
			}
		];

		const query = 'Where is the auth token refresh handler?';
		const results = TFIDFSearch.search(query, indexedFiles, 2);

		assert.strictEqual(results.length, 2);
		// 'src/utils/auth.ts' has 'auth', 'token', 'refresh', matching query closely
		assert.strictEqual(results[0], 'src/utils/auth.ts');
	});
});
