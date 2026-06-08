import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ProjectConfig {
	techStack?: string;
	ignorePatterns?: string[];
	additionalInstructions?: string;
}

let cachedConfig: ProjectConfig | null | undefined = undefined;

export function clearProjectConfigCache(): void {
	cachedConfig = undefined;
}

function findConfigFilePath(rootPath: string): string | undefined {
	const candidates = ['.issuemaprc', '.issue-mapper.json'];
	for (const name of candidates) {
		const fullPath = path.join(rootPath, name);
		if (fs.existsSync(fullPath)) {
			return fullPath;
		}
	}
	return undefined;
}

function parseConfigFile(filePath: string): ProjectConfig | null {
	try {
		const content = fs.readFileSync(filePath, 'utf8');
		const data = JSON.parse(content) as Record<string, unknown>;

		const config: ProjectConfig = {};

		if (typeof data.techStack === 'string' && data.techStack.trim().length > 0) {
			config.techStack = data.techStack.trim();
		}

		if (Array.isArray(data.ignorePatterns)) {
			const filtered = data.ignorePatterns.filter(
				(p: unknown) => typeof p === 'string' && p.trim().length > 0
			);
			if (filtered.length > 0) {
				config.ignorePatterns = filtered;
			}
		}

		if (typeof data.additionalInstructions === 'string' && data.additionalInstructions.trim().length > 0) {
			config.additionalInstructions = data.additionalInstructions.trim();
		}

		if (!config.techStack && !config.ignorePatterns && !config.additionalInstructions) {
			return null;
		}

		return config;
	} catch (e) {
		console.error(`Gagal mengurai berkas konfigurasi proyek "${filePath}":`, e);
		return null;
	}
}

export async function loadProjectConfig(): Promise<ProjectConfig | null> {
	if (cachedConfig !== undefined) {
		return cachedConfig;
	}

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		cachedConfig = null;
		return null;
	}

	const rootPath = workspaceFolders[0].uri.fsPath;
	const configPath = findConfigFilePath(rootPath);

	if (!configPath) {
		cachedConfig = null;
		return null;
	}

	cachedConfig = parseConfigFile(configPath);
	return cachedConfig;
}

export function formatProjectConfig(config: ProjectConfig): string {
	const parts: string[] = [];

	if (config.techStack) {
		parts.push(`Tech Stack Proyek: ${config.techStack}`);
	}

	if (config.additionalInstructions) {
		parts.push(`Instruksi Arsitektur: ${config.additionalInstructions}`);
	}

	return parts.join('\n');
}

export function getProjectIgnorePatterns(): string[] {
	if (cachedConfig && cachedConfig.ignorePatterns) {
		return cachedConfig.ignorePatterns;
	}
	return [];
}
