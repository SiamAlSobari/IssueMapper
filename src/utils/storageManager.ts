import * as vscode from 'vscode';

export type AIProvider = 'openai' | 'gemini' | 'groq' | 'ollama';

export interface GitHubIssue {
	number: number;
	title: string;
	body: string;
	state: string;
	labels: { name: string; color: string }[];
}

export interface IssueFilters {
	label?: string;
	search?: string;
}

const SECRET_KEYS = ['openai-api-key', 'gemini-api-key', 'groq-api-key'] as const;
type SecretKey = (typeof SECRET_KEYS)[number];

const GLOBAL_STATE_KEYS = ['activeProvider', 'selectedModel'] as const;
type GlobalStateKey = (typeof GLOBAL_STATE_KEYS)[number];

const WORKSPACE_STATE_KEYS = ['cachedIssues', 'lastSyncedTime', 'issueFilters'] as const;
type WorkspaceStateKey = (typeof WORKSPACE_STATE_KEYS)[number];

export class StorageManager {
	private _secrets: vscode.SecretStorage;
	private _globalState: vscode.Memento;
	private _workspaceState: vscode.Memento;

	constructor(context: vscode.ExtensionContext) {
		this._secrets = context.secrets;
		this._globalState = context.globalState;
		this._workspaceState = context.workspaceState;
	}

	async getApiKey(key: SecretKey): Promise<string | undefined> {
		return this._secrets.get(key);
	}

	async setApiKey(key: SecretKey, value: string): Promise<void> {
		await this._secrets.store(key, value);
	}

	async deleteApiKey(key: SecretKey): Promise<void> {
		await this._secrets.delete(key);
	}

	getActiveProvider(): AIProvider {
		return (this._globalState.get<string>('activeProvider') as AIProvider) ?? 'openai';
	}

	async setActiveProvider(provider: AIProvider): Promise<void> {
		await this._globalState.update('activeProvider', provider);
	}

	getSelectedModel(): string {
		return this._globalState.get<string>('selectedModel') ?? 'gpt-4o-mini';
	}

	async setSelectedModel(model: string): Promise<void> {
		await this._globalState.update('selectedModel', model);
	}

	getCachedIssues(): GitHubIssue[] {
		return this._workspaceState.get<GitHubIssue[]>('cachedIssues') ?? [];
	}

	async setCachedIssues(issues: GitHubIssue[]): Promise<void> {
		await this._workspaceState.update('cachedIssues', issues);
	}

	getLastSyncedTime(): number | undefined {
		return this._workspaceState.get<number>('lastSyncedTime');
	}

	async setLastSyncedTime(timestamp: number): Promise<void> {
		await this._workspaceState.update('lastSyncedTime', timestamp);
	}

	getIssueFilters(): IssueFilters {
		return this._workspaceState.get<IssueFilters>('issueFilters') ?? {};
	}

	async setIssueFilters(filters: IssueFilters): Promise<void> {
		await this._workspaceState.update('issueFilters', filters);
	}
}
