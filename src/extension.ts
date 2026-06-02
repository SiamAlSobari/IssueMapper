import * as vscode from 'vscode';
import { SidebarProvider } from './providers/SidebarProvider';
import { StorageManager } from './utils/storageManager';

export let storageManager: StorageManager;

export function activate(context: vscode.ExtensionContext) {
	storageManager = new StorageManager(context);

	const sidebarProvider = new SidebarProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebarProvider)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('issueMapper.refresh', () => {
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
