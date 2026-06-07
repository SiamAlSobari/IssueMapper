import * as vscode from 'vscode';
import { SidebarProvider } from './providers/SidebarProvider';
import { StorageManager } from './utils/storageManager';
import { clearProjectConfigCache } from './ai/projectConfig';
import { WorkspaceSemanticIndexer } from './utils/embedding';

export let storageManager: StorageManager;

export function activate(context: vscode.ExtensionContext) {
	storageManager = new StorageManager(context);

	const sidebarProvider = new SidebarProvider(context.extensionUri, context);

	const indexer = new WorkspaceSemanticIndexer(context);
	indexer.startIndexingInBackground();

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebarProvider)
	);

	// Register file watcher for project configuration files
	const configWatcher = vscode.workspace.createFileSystemWatcher('**/{.issuemaprc,.issue-mapper.json}');
	configWatcher.onDidChange(() => clearProjectConfigCache());
	configWatcher.onDidCreate(() => clearProjectConfigCache());
	configWatcher.onDidDelete(() => clearProjectConfigCache());
	context.subscriptions.push(configWatcher);

	context.subscriptions.push(
		vscode.commands.registerCommand('issueMapper.refresh', () => {
			clearProjectConfigCache();
			indexer.startIndexingInBackground();
			sidebarProvider.refresh();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('issueMapper.openSettings', () => {
			vscode.commands.executeCommand('workbench.action.openSettings', '@ext:issue-mapper');
		})
	);
}

export function deactivate() {}
