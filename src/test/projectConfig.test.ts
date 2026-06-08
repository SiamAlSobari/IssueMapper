import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
	loadProjectConfig,
	clearProjectConfigCache,
	formatProjectConfig,
	getProjectIgnorePatterns,
	ProjectConfig
} from '../ai/projectConfig';

suite('Project Configuration Test Suite', () => {
	let rootPath: string | undefined;

	suiteSetup(() => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			rootPath = workspaceFolders[0].uri.fsPath;
		}
	});

	setup(() => {
		clearProjectConfigCache();
	});

	teardown(() => {
		clearProjectConfigCache();
		if (rootPath) {
			const rcPath = path.join(rootPath, '.issuemaprc');
			const jsonPath = path.join(rootPath, '.issue-mapper.json');
			if (fs.existsSync(rcPath)) {
				fs.unlinkSync(rcPath);
			}
			if (fs.existsSync(jsonPath)) {
				fs.unlinkSync(jsonPath);
			}
		}
	});

	test('loadProjectConfig should return null when no config file exists', async () => {
		const config = await loadProjectConfig();
		assert.strictEqual(config, null);
	});

	test('loadProjectConfig should detect and parse .issuemaprc correctly', async () => {
		if (!rootPath) {
			assert.fail('Workspace root path not available');
		}

		const mockConfig: ProjectConfig = {
			techStack: 'Next.js, TailwindCSS, Prisma',
			ignorePatterns: ['**/public/**', '**/dist/**'],
			additionalInstructions: 'Gunakan standard clean architecture.'
		};

		const rcPath = path.join(rootPath, '.issuemaprc');
		fs.writeFileSync(rcPath, JSON.stringify(mockConfig), 'utf8');

		const config = await loadProjectConfig();
		assert.notStrictEqual(config, null);
		assert.strictEqual(config?.techStack, mockConfig.techStack);
		assert.deepStrictEqual(config?.ignorePatterns, mockConfig.ignorePatterns);
		assert.strictEqual(config?.additionalInstructions, mockConfig.additionalInstructions);
	});

	test('loadProjectConfig should detect and parse .issue-mapper.json correctly', async () => {
		if (!rootPath) {
			assert.fail('Workspace root path not available');
		}

		const mockConfig: ProjectConfig = {
			techStack: 'React, Vite, CSS Modules',
			ignorePatterns: ['**/out/**'],
			additionalInstructions: 'Pisahkan service layer dan controller.'
		};

		const jsonPath = path.join(rootPath, '.issue-mapper.json');
		fs.writeFileSync(jsonPath, JSON.stringify(mockConfig), 'utf8');

		const config = await loadProjectConfig();
		assert.notStrictEqual(config, null);
		assert.strictEqual(config?.techStack, mockConfig.techStack);
		assert.deepStrictEqual(config?.ignorePatterns, mockConfig.ignorePatterns);
		assert.strictEqual(config?.additionalInstructions, mockConfig.additionalInstructions);
	});

	test('formatProjectConfig should format config correctly', () => {
		const config: ProjectConfig = {
			techStack: 'Svelte, Tailwind',
			additionalInstructions: 'Tulis testing lengkap.'
		};

		const formatted = formatProjectConfig(config);
		assert.ok(formatted.includes('Tech Stack Proyek: Svelte, Tailwind'));
		assert.ok(formatted.includes('Instruksi Arsitektur: Tulis testing lengkap.'));
	});

	test('getProjectIgnorePatterns should return ignore patterns', async () => {
		if (!rootPath) {
			assert.fail('Workspace root path not available');
		}

		const mockConfig: ProjectConfig = {
			ignorePatterns: ['**/dist/**', '**/build/**']
		};

		const rcPath = path.join(rootPath, '.issuemaprc');
		fs.writeFileSync(rcPath, JSON.stringify(mockConfig), 'utf8');

		await loadProjectConfig();
		const ignorePatterns = getProjectIgnorePatterns();
		assert.deepStrictEqual(ignorePatterns, mockConfig.ignorePatterns);
	});
});
