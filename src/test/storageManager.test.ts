import * as assert from 'assert';
import * as vscode from 'vscode';
import { StorageManager, GitHubIssue, IssueFilters } from '../utils/storageManager';

class MockMemento implements vscode.Memento {
	private _storage = new Map<string, unknown>();

	keys(): readonly string[] {
		return Array.from(this._storage.keys());
	}

	get(key: string): unknown;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: unknown, defaultValue?: T): unknown {
		return this._storage.has(key as string) ? this._storage.get(key as string) : defaultValue;
	}

	update(key: string, value: unknown): Thenable<void> {
		if (value === undefined) {
			this._storage.delete(key);
		} else {
			this._storage.set(key, value);
		}
		return Promise.resolve();
	}

	setKeysForSync(keys: readonly string[]): void {}
}

class MockSecretStorage implements vscode.SecretStorage {
	private _storage = new Map<string, string>();

	onDidChange = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event;

	get(key: string): Thenable<string | undefined> {
		return Promise.resolve(this._storage.get(key));
	}

	store(key: string, value: string): Thenable<void> {
		this._storage.set(key, value);
		return Promise.resolve();
	}

	delete(key: string): Thenable<void> {
		this._storage.delete(key);
		return Promise.resolve();
	}

	keys(): Thenable<string[]> {
		return Promise.resolve(Array.from(this._storage.keys()));
	}
}

suite('StorageManager Test Suite', () => {
	let mockGlobalState: MockMemento;
	let mockWorkspaceState: MockMemento;
	let mockSecrets: MockSecretStorage;
	let mockContext: vscode.ExtensionContext;
	let storageManager: StorageManager;

	setup(() => {
		mockGlobalState = new MockMemento();
		mockWorkspaceState = new MockMemento();
		mockSecrets = new MockSecretStorage();

		mockContext = {
			globalState: mockGlobalState,
			workspaceState: mockWorkspaceState,
			secrets: mockSecrets,
			subscriptions: [],
			extensionUri: { fsPath: '' } as vscode.Uri,
			extensionPath: '',
			storageUri: undefined,
			storagePath: undefined,
			logPath: '',
			extensionMode: vscode.ExtensionMode.Test
		} as unknown as vscode.ExtensionContext;

		storageManager = new StorageManager(mockContext);
	});

	test('API Key storage operations (store, get, delete)', async () => {
		// Verify default value is undefined
		const initialKey = await storageManager.getApiKey('openai-api-key');
		assert.strictEqual(initialKey, undefined);

		// Store key
		await storageManager.setApiKey('openai-api-key', 'test-openai-token');
		const storedKey = await storageManager.getApiKey('openai-api-key');
		assert.strictEqual(storedKey, 'test-openai-token');

		// Delete key
		await storageManager.deleteApiKey('openai-api-key');
		const deletedKey = await storageManager.getApiKey('openai-api-key');
		assert.strictEqual(deletedKey, undefined);
	});

	test('Active Provider configuration', async () => {
		// Default active provider should be 'openai'
		assert.strictEqual(storageManager.getActiveProvider(), 'openai');

		// Set active provider
		await storageManager.setActiveProvider('gemini');
		assert.strictEqual(storageManager.getActiveProvider(), 'gemini');

		await storageManager.setActiveProvider('groq');
		assert.strictEqual(storageManager.getActiveProvider(), 'groq');
	});

	test('Selected Model configuration', async () => {
		// Default selected model should be 'gpt-4o-mini'
		assert.strictEqual(storageManager.getSelectedModel(), 'gpt-4o-mini');

		// Set selected model
		await storageManager.setSelectedModel('gemini-1.5-flash');
		assert.strictEqual(storageManager.getSelectedModel(), 'gemini-1.5-flash');
	});

	test('Ollama Host URL configuration', async () => {
		// Default Ollama Host URL should be 'http://localhost:11434'
		assert.strictEqual(storageManager.getOllamaHostUrl(), 'http://localhost:11434');

		// Set Ollama Host URL
		await storageManager.setOllamaHostUrl('http://127.0.0.1:11435');
		assert.strictEqual(storageManager.getOllamaHostUrl(), 'http://127.0.0.1:11435');
	});

	test('Cached Issues storage operations', async () => {
		// Default cached issues should be empty array
		assert.deepStrictEqual(storageManager.getCachedIssues(), []);

		const mockIssues: GitHubIssue[] = [
			{
				number: 1,
				title: 'Test Issue 1',
				body: 'Description 1',
				state: 'open',
				labels: [{ name: 'bug', color: 'red' }],
				author: 'testuser'
			}
		];

		// Save cached issues
		await storageManager.setCachedIssues(mockIssues);
		assert.deepStrictEqual(storageManager.getCachedIssues(), mockIssues);
	});

	test('Last Synced Time storage operations', async () => {
		// Default should be undefined
		assert.strictEqual(storageManager.getLastSyncedTime(), undefined);

		const now = Date.now();
		await storageManager.setLastSyncedTime(now);
		assert.strictEqual(storageManager.getLastSyncedTime(), now);
	});

	test('Issue Filters storage operations', async () => {
		// Default should be empty object
		assert.deepStrictEqual(storageManager.getIssueFilters(), {});

		const filters: IssueFilters = {
			label: 'bug',
			search: 'login error'
		};

		await storageManager.setIssueFilters(filters);
		assert.deepStrictEqual(storageManager.getIssueFilters(), filters);
	});
});
