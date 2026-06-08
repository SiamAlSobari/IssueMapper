import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { fetchGitHubIssues, postGitHubComment, updateGitHubIssueState, updateGitHubIssueBody, createGitHubIssue } from '../utils/github';
import { storageManager } from '../extension';
import { getWorkspaceFiles, getGitContext } from '../utils/workspaceScanner';
import { AIProviderFactory } from '../ai/AIClient';
import { loadProjectConfig, getProjectIgnorePatterns } from '../ai/projectConfig';
import { WorkspaceSemanticIndexer } from '../utils/embedding';
import { CodeFixRequest } from '../ai/codeFixPrompt';

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewId = 'issueMapper.sidebar';
	private _view?: vscode.WebviewView;
	private _highlightDecorationType?: vscode.TextEditorDecorationType;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _context: vscode.ExtensionContext
	) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._view = webviewView;
		const webviewPath = vscode.Uri.joinPath(this._extensionUri, 'webview', 'dist');

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [webviewPath],
		};

		webviewView.webview.html = this._getHtml(webviewView.webview, webviewPath);

		// Ambil filter tersimpan dari storageManager
		const initialFilters = storageManager.getIssueFilters();

		webviewView.webview.onDidReceiveMessage(async (message) => {
			switch (message.command) {
				case 'generateFix': {
					await loadProjectConfig();
					const ignorePatterns = getProjectIgnorePatterns();
					const gitContext = await getGitContext();

					const activeProvider = storageManager.getActiveProvider();
					const selectedModel = storageManager.getSelectedModel();
					let apiKey = '';

					if (activeProvider === 'openai') {
						apiKey = await storageManager.getApiKey('openai-api-key') || '';
					} else if (activeProvider === 'gemini') {
						apiKey = await storageManager.getApiKey('gemini-api-key') || '';
					} else if (activeProvider === 'groq') {
						apiKey = await storageManager.getApiKey('groq-api-key') || '';
					}

					if (!apiKey && activeProvider !== 'ollama') {
						vscode.window.showWarningMessage(`Kunci API untuk "${activeProvider}" belum dikonfigurasi.`);
						webviewView.webview.postMessage({
							command: 'generateFixResult',
							success: false,
							error: `Kunci API ${activeProvider.toUpperCase()} belum dikonfigurasi.`
						});
						return;
					}

					try {
						const client = AIProviderFactory.create(
							activeProvider,
							apiKey,
							selectedModel,
							activeProvider === 'ollama' ? storageManager.getOllamaHostUrl() : undefined
						);

						const activeEditor = vscode.window.activeTextEditor;
						if (!activeEditor) {
							webviewView.webview.postMessage({
								command: 'generateFixResult',
								success: false,
								error: 'Tidak ada file aktif yang terbuka di editor.'
							});
							return;
						}

						const document = activeEditor.document;
						const filePath = vscode.workspace.asRelativePath(document.uri);
						const fileContent = document.getText();

						const request: CodeFixRequest = {
							filePath,
							fileContent,
							issueTitle: message.title || '',
							issueDescription: message.body || '',
							gitBranch: gitContext.activeBranch || undefined,
						};

						const result = await client.generateCodeFix(request);

						webviewView.webview.postMessage({
							command: 'generateFixResult',
							success: true,
							number: message.number,
							fixes: result.fixes,
							explanation: result.explanation,
						});
					} catch (err: unknown) {
						vscode.window.showErrorMessage(`Gagal menghasilkan perbaikan kode: ${(err as Error).message}`);
						webviewView.webview.postMessage({
							command: 'generateFixResult',
							success: false,
							error: (err as Error).message || 'Gagal terhubung ke penyedia AI.'
						});
					}
					return;
				}
				case 'applyCodePatch': {
					try {
						const { filePath: targetPath, oldCode, newCode } = message;

						if (!targetPath || oldCode === undefined || newCode === undefined) {
							webviewView.webview.postMessage({
								command: 'applyCodePatchResult',
								success: false,
								error: 'Data patch tidak lengkap.'
							});
							return;
						}

						if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
							webviewView.webview.postMessage({
								command: 'applyCodePatchResult',
								success: false,
								error: 'Tidak ada workspace aktif.'
							});
							return;
						}

						const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
						const fullPath = path.join(workspaceRoot, targetPath);

						if (!fs.existsSync(fullPath)) {
							webviewView.webview.postMessage({
								command: 'applyCodePatchResult',
								success: false,
								error: `Berkas tidak ditemukan: ${targetPath}`
							});
							return;
						}

						const currentContent = fs.readFileSync(fullPath, 'utf8');
						if (currentContent !== oldCode) {
							const applyAnyway = await vscode.window.showWarningMessage(
								`Berkas ${targetPath} telah berubah sejak patch dibuat. Tetap terapkan?`,
								'Ya, Terapkan',
								'Batal'
							);
							if (applyAnyway !== 'Ya, Terapkan') {
								webviewView.webview.postMessage({
									command: 'applyCodePatchResult',
									success: false,
									error: 'Patch dibatalkan: berkas telah berubah.',
									cancelled: true
								});
								return;
							}
						}

						const confirmApply = await vscode.window.showInformationMessage(
							`Terapkan patch ke ${targetPath}? Backup akan dibuat sebagai ${targetPath}.backup`,
							'Terapkan',
							'Batal'
						);
						if (confirmApply !== 'Terapkan') {
							webviewView.webview.postMessage({
								command: 'applyCodePatchResult',
								success: false,
								error: 'Patch dibatalkan oleh pengguna.',
								cancelled: true
							});
							return;
						}

						const backupPath = fullPath + '.backup';
						fs.copyFileSync(fullPath, backupPath);

						const fullContent = fs.readFileSync(fullPath, 'utf8');
						const updatedContent = fullContent.replace(oldCode, newCode);

						if (updatedContent === fullContent) {
							fs.unlinkSync(backupPath);
							webviewView.webview.postMessage({
								command: 'applyCodePatchResult',
								success: false,
								error: 'Tidak dapat menemukan kode yang cocok di berkas untuk diganti.'
							});
							return;
						}

						fs.writeFileSync(fullPath, updatedContent, 'utf8');

						const doc = await vscode.workspace.openTextDocument(fullPath);
						await vscode.window.showTextDocument(doc);

						vscode.window.showInformationMessage(
							`Patch berhasil diterapkan ke ${targetPath}. Backup disimpan sebagai ${targetPath}.backup`
						);

						webviewView.webview.postMessage({
							command: 'applyCodePatchResult',
							success: true,
							filePath: targetPath,
							backupPath: targetPath + '.backup'
						});
					} catch (err: unknown) {
						vscode.window.showErrorMessage(`Gagal menerapkan patch: ${(err as Error).message}`);
						webviewView.webview.postMessage({
							command: 'applyCodePatchResult',
							success: false,
							error: (err as Error).message || 'Gagal menulis perubahan ke berkas.'
						});
					}
					return;
				}
				case 'getIssues': {
					// Dapatkan issues dari cache dulu jika ada
					const cached = storageManager.getCachedIssues();
					
					// Jika offline, gunakan cache saja dan jangan panggil API GitHub
					if (message.isOffline) {
						webviewView.webview.postMessage({
							command: 'issuesLoaded',
							issues: cached,
							currentUser: 'Colorful',
							repoDetected: true,
							authenticated: false,
							fromCache: true,
							isOffline: true
						});
						return;
					}

					if (cached && cached.length > 0) {
						webviewView.webview.postMessage({
							command: 'issuesLoaded',
							issues: cached,
							currentUser: 'Colorful',
							repoDetected: true,
							authenticated: true,
							fromCache: true
						});
					}

					// Lakukan sinkronisasi riil di background
					const result = await fetchGitHubIssues(false);
					await storageManager.setCachedIssues(result.issues);
					await storageManager.setLastSyncedTime(Date.now());
					
					webviewView.webview.postMessage({
						command: 'issuesLoaded',
						issues: result.issues,
						currentUser: result.currentUser,
						repoDetected: result.repoDetected,
						authenticated: result.authenticated,
						fromCache: false
					});
					return;
				}
				case 'refreshIssues': {
					// Jika offline, kembalikan cache langsung
					if (message.isOffline) {
						const cached = storageManager.getCachedIssues();
						webviewView.webview.postMessage({
							command: 'issuesLoaded',
							issues: cached,
							currentUser: 'Colorful',
							repoDetected: true,
							authenticated: false,
							fromCache: true,
							isOffline: true
						});
						vscode.window.showWarningMessage("Koneksi offline. Menampilkan data cache lokal.");
						return;
					}

					// Memaksa memicu dialog login jika forceRefresh dipicu
					const result = await fetchGitHubIssues(true);
					await storageManager.setCachedIssues(result.issues);
					await storageManager.setLastSyncedTime(Date.now());

					webviewView.webview.postMessage({
						command: 'issuesLoaded',
						issues: result.issues,
						currentUser: result.currentUser,
						repoDetected: result.repoDetected,
						authenticated: result.authenticated,
						fromCache: false
					});
					return;
				}
				case 'saveFilters': {
					await storageManager.setIssueFilters(message.filters);
					return;
				}
				case 'getInitialState': {
					webviewView.webview.postMessage({
						command: 'initialState',
						filters: initialFilters,
						activeProvider: storageManager.getActiveProvider(),
						selectedModel: storageManager.getSelectedModel()
					});
					return;
				}
				case 'openFile': {
					if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
						vscode.window.showErrorMessage("Tidak ada workspace aktif.");
						return;
					}
					const uri = vscode.Uri.joinPath(
						vscode.workspace.workspaceFolders[0].uri,
						message.filePath
					);
					try {
						const document = await vscode.workspace.openTextDocument(uri);
						const editor = await vscode.window.showTextDocument(document);

						const lineRange = message.lineRange as { start: number; end: number } | undefined;
						if (lineRange && lineRange.start > 0 && lineRange.end >= lineRange.start) {
							const startLine = Math.min(lineRange.start - 1, document.lineCount - 1);
							const endLine = Math.min(lineRange.end - 1, document.lineCount - 1);
							const range = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);

							editor.selection = new vscode.Selection(range.start, range.start);
							editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

							if (this._highlightDecorationType) {
								this._highlightDecorationType.dispose();
							}
							this._highlightDecorationType = vscode.window.createTextEditorDecorationType({
								backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
								isWholeLine: true,
								borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder'),
								borderWidth: '1px',
								borderStyle: 'solid',
								overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchHighlightForeground'),
								overviewRulerLane: vscode.OverviewRulerLane.Full
							});
							editor.setDecorations(this._highlightDecorationType, [range]);

							const timeoutMs = 5000;
							setTimeout(() => {
								if (this._highlightDecorationType) {
									this._highlightDecorationType.dispose();
									this._highlightDecorationType = undefined;
								}
							}, timeoutMs);
						}
					} catch (err: unknown) {
						vscode.window.showErrorMessage(`Gagal membuka berkas: ${(err as Error).message}`);
					}
					return;
				}
				case 'analyzeIssue': {
					// Muat konfigurasi proyek (.issuemaprc / .issue-mapper.json)
					await loadProjectConfig();
					const ignorePatterns = getProjectIgnorePatterns();

					const [files, gitContext] = await Promise.all([
						getWorkspaceFiles(ignorePatterns.length > 0 ? ignorePatterns : undefined),
						getGitContext()
					]);

					const activeProvider = storageManager.getActiveProvider();
					const selectedModel = storageManager.getSelectedModel();
					let apiKey = '';

					if (activeProvider === 'openai') {
						apiKey = await storageManager.getApiKey('openai-api-key') || '';
					} else if (activeProvider === 'gemini') {
						apiKey = await storageManager.getApiKey('gemini-api-key') || '';
					} else if (activeProvider === 'groq') {
						apiKey = await storageManager.getApiKey('groq-api-key') || '';
					}

					// Ambil detail deskripsi issue dari cache jika tidak terkirim di message
					const cachedIssues = storageManager.getCachedIssues();
					const currentIssue = cachedIssues.find(i => i.number === message.number);
					const issueBody = currentIssue ? currentIssue.body : (message.body || '');

					// Menyeleksi berkas paling relevan menggunakan Semantic Search lokal (Ollama / TF-IDF)
					let filesToAnalyze = files;
					if (files.length > 25) {
						try {
							const indexer = new WorkspaceSemanticIndexer(this._context);
							filesToAnalyze = await indexer.findRelevantFiles(message.title || '', issueBody, 20);
						} catch (e) {
							console.error('Pencarian semantik gagal, fallback ke semua berkas:', e);
						}
					}

					if (!apiKey && activeProvider !== 'ollama') {
						// Fallback ke simulasi jika kunci API belum diset
						vscode.window.showWarningMessage(`Kunci API untuk "${activeProvider}" belum dikonfigurasi. Menggunakan hasil simulasi.`);
						const analysis = await this._getMockAnalysis(message.number, message.title, filesToAnalyze);
						webviewView.webview.postMessage({
							command: 'analysisResult',
							number: message.number,
							files: analysis.files,
							summary: `[Kunci API Belum Dikonfigurasi] Menampilkan hasil simulasi:\n\n${analysis.summary}`,
							error: `Kunci API ${activeProvider.toUpperCase()} belum dikonfigurasi. Silakan buka Pengaturan (Settings) untuk memasukkannya.`
						});
						return;
					}

					try {
						const client = AIProviderFactory.create(
							activeProvider,
							apiKey,
							selectedModel,
							activeProvider === 'ollama' ? storageManager.getOllamaHostUrl() : undefined
						);

						const analysis = await client.analyzeIssue(message.title, issueBody, filesToAnalyze, gitContext);

						webviewView.webview.postMessage({
							command: 'analysisResult',
							number: message.number,
							files: analysis.files,
							summary: analysis.summary
						});
					} catch (err: unknown) {
						vscode.window.showErrorMessage(`Gagal melakukan analisis AI: ${(err as Error).message}`);

						// Jika gagal, fallback ke mock analisis
						const analysis = await this._getMockAnalysis(message.number, message.title, filesToAnalyze);
						webviewView.webview.postMessage({
							command: 'analysisResult',
							number: message.number,
							files: analysis.files,
							summary: `[Koneksi AI Gagal] Fallback ke data simulasi:\n\n${analysis.summary}`,
							error: (err as Error).message || 'Gagal terhubung ke penyedia AI.'
						});
					}
					return;
				}
				case 'quickSuggest': {
					// Ambil info file aktif yang dibuka di editor (Context Retrieval - Stage 2)
					const activeEditor = vscode.window.activeTextEditor;
					let codeContext = '';
					if (activeEditor) {
						const document = activeEditor.document;
						const fileName = document.fileName;
						const fileText = document.getText();
						// Ambil sebagian isi file (maksimal 10.000 karakter)
						codeContext = `File Aktif: ${fileName}\n\n\`\`\`\n${fileText.substring(0, 10000)}\n\`\`\``;
					} else {
						codeContext = 'Tidak ada file aktif yang sedang dibuka di editor.';
					}

					const activeProvider = storageManager.getActiveProvider();
					const selectedModel = storageManager.getSelectedModel();
					let apiKey = '';

					if (activeProvider === 'openai') {
						apiKey = await storageManager.getApiKey('openai-api-key') || '';
					} else if (activeProvider === 'gemini') {
						apiKey = await storageManager.getApiKey('gemini-api-key') || '';
					} else if (activeProvider === 'groq') {
						apiKey = await storageManager.getApiKey('groq-api-key') || '';
					}

					// Ambil deskripsi issue dari cache
					const cachedIssues = storageManager.getCachedIssues();
					const currentIssue = cachedIssues.find(i => i.number === message.number);
					const issueTitle = currentIssue ? currentIssue.title : message.title;
					const issueBody = currentIssue ? currentIssue.body : '';

					if (!apiKey && activeProvider !== 'ollama') {
						vscode.window.showWarningMessage(`Kunci API untuk "${activeProvider}" belum dikonfigurasi. Menggunakan saran simulasi.`);
						const suggestion = this._getMockSuggestion(message.number, issueTitle);
						webviewView.webview.postMessage({
							command: 'quickSuggestResult',
							number: message.number,
							suggestion
						});
						return;
					}

					try {
						const client = AIProviderFactory.create(
							activeProvider,
							apiKey,
							selectedModel,
							activeProvider === 'ollama' ? storageManager.getOllamaHostUrl() : undefined
						);

						const fullPrompt = `Issue #${message.number}: ${issueTitle}\nDescription: ${issueBody}`;
						const suggestion = await client.generateReply(fullPrompt, codeContext);
						
						webviewView.webview.postMessage({
							command: 'quickSuggestResult',
							number: message.number,
							suggestion
						});
					} catch (err: unknown) {
						vscode.window.showErrorMessage(`Gagal menghasilkan draf saran AI: ${(err as Error).message}`);
						const mockSuggestion = this._getMockSuggestion(message.number, issueTitle);
						webviewView.webview.postMessage({
							command: 'quickSuggestResult',
							number: message.number,
							suggestion: `[Gagal koneksi AI: ${(err as Error).message}] Fallback ke data simulasi:\n\n${mockSuggestion}`
						});
					}
					return;
				}
				case 'saveSettings': {
					try {
						await storageManager.setActiveProvider(message.provider);
						await storageManager.setSelectedModel(message.model);

						if (message.ollamaUrl) {
							await storageManager.setOllamaHostUrl(message.ollamaUrl);
						}

						// Simpan jika nilai kunci diubah (bukan placeholder '••••••••')
						if (message.openaiKey !== undefined && message.openaiKey !== '••••••••') {
							if (message.openaiKey === '') {
								await storageManager.deleteApiKey('openai-api-key');
							} else {
								await storageManager.setApiKey('openai-api-key', message.openaiKey);
							}
						}
						if (message.geminiKey !== undefined && message.geminiKey !== '••••••••') {
							if (message.geminiKey === '') {
								await storageManager.deleteApiKey('gemini-api-key');
							} else {
								await storageManager.setApiKey('gemini-api-key', message.geminiKey);
							}
						}
						if (message.groqKey !== undefined && message.groqKey !== '••••••••') {
							if (message.groqKey === '') {
								await storageManager.deleteApiKey('groq-api-key');
							} else {
								await storageManager.setApiKey('groq-api-key', message.groqKey);
							}
						}

						vscode.window.showInformationMessage('Pengaturan IssueMapper AI berhasil disimpan.');

						// Kirim balik status terbaru ke webview agar UI tersinkronisasi
						webviewView.webview.postMessage({
							command: 'settingsSaved',
							activeProvider: storageManager.getActiveProvider(),
							selectedModel: storageManager.getSelectedModel(),
							ollamaHostUrl: storageManager.getOllamaHostUrl()
						});
					} catch (err: unknown) {
						vscode.window.showErrorMessage(`Gagal menyimpan pengaturan: ${(err as Error).message}`);
					}
					return;
				}
				case 'getSettings': {
					try {
						const hasOpenaiKey = !!(await storageManager.getApiKey('openai-api-key'));
						const hasGeminiKey = !!(await storageManager.getApiKey('gemini-api-key'));
						const hasGroqKey = !!(await storageManager.getApiKey('groq-api-key'));

						webviewView.webview.postMessage({
							command: 'settingsLoaded',
							activeProvider: storageManager.getActiveProvider(),
							selectedModel: storageManager.getSelectedModel(),
							ollamaHostUrl: storageManager.getOllamaHostUrl(),
							hasOpenaiKey,
							hasGeminiKey,
							hasGroqKey
						});
					} catch (err: unknown) {
						console.error("Gagal memuat pengaturan:", String(err));
					}
					return;
				}
				case 'loginGitHub': {
					// Menampilkan dialog informasi interaktif terlebih dahulu agar user sadar ada alur login
					const selection = await vscode.window.showInformationMessage(
						"IssueMapper AI memerlukan otentikasi akun GitHub Anda untuk menarik daftar issue secara real-time. Lanjutkan ke browser untuk masuk?",
						"Lanjutkan",
						"Batal"
					);

					if (selection !== "Lanjutkan") {
						return;
					}

					try {
						// Memicu dialog login GitHub secara interaktif
						const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
						if (session) {
							// Refresh daftar issue secara paksa setelah login berhasil
							const result = await fetchGitHubIssues(false);
							await storageManager.setCachedIssues(result.issues);
							await storageManager.setLastSyncedTime(Date.now());
							
							webviewView.webview.postMessage({
								command: 'issuesLoaded',
								issues: result.issues,
								currentUser: result.currentUser,
								repoDetected: result.repoDetected,
								authenticated: true,
								fromCache: false
							});
							vscode.window.showInformationMessage("Berhasil terhubung dengan GitHub!");
						}
					} catch (err: unknown) {
						vscode.window.showErrorMessage(`Gagal menghubungkan GitHub: ${(err as Error).message}`);
					}
					return;
				}
			case 'postComment': {
					// Kirim balasan issue ke GitHub secara riil
					const commentSuccess = await postGitHubComment(message.number, message.comment);
					let stateSuccess = true;

					if (message.close) {
						stateSuccess = await updateGitHubIssueState(message.number, 'closed');
					}

					if (commentSuccess && stateSuccess) {
						vscode.window.showInformationMessage(
							message.close 
								? `Komentar berhasil dikirim. Issue #${message.number} ditutup di GitHub.` 
								: `Komentar berhasil diposting ke GitHub.`
						);
					} else {
						vscode.window.showWarningMessage(
							`Gagal mengirim secara online ke GitHub. Periksa otentikasi akun Anda.`
						);
					}

					// Update cache lokal
					const issues = storageManager.getCachedIssues();
					const updatedIssues = issues.map(iss => {
						if (iss.number === message.number) {
							return {
								...iss,
								state: (message.close && commentSuccess && stateSuccess) ? 'closed' : iss.state
							};
						}
						return iss;
					});
					
					await storageManager.setCachedIssues(updatedIssues);

					webviewView.webview.postMessage({
						command: 'postCommentResult',
						success: true, // Berikan true agar UI React tetap mengupdate view lokal
						number: message.number,
						updatedIssues
					});
					return;
				}
				case 'toggleIssueState': {
					const targetState = message.state; // 'open' | 'closed'
					const stateSuccess = await updateGitHubIssueState(message.number, targetState);

					if (stateSuccess) {
						vscode.window.showInformationMessage(
							targetState === 'closed'
								? `Issue #${message.number} berhasil ditutup di GitHub.`
								: `Issue #${message.number} berhasil dibuka kembali di GitHub.`
						);
					} else {
						vscode.window.showWarningMessage(
							`Gagal mengubah status issue ke GitHub. Periksa otentikasi akun Anda.`
						);
					}

					// Update cache lokal
					const issues = storageManager.getCachedIssues();
					const updatedIssues = issues.map(iss => {
						if (iss.number === message.number) {
							return {
								...iss,
								state: (stateSuccess) ? targetState : iss.state
							};
						}
						return iss;
					});
					
					await storageManager.setCachedIssues(updatedIssues);

					webviewView.webview.postMessage({
						command: 'toggleIssueStateResult',
						success: stateSuccess,
						number: message.number,
						state: targetState,
						updatedIssues
					});
					return;
				}
				case 'updateIssueBody': {
					const bodySuccess = await updateGitHubIssueBody(message.number, message.body);
					if (bodySuccess) {
						const issueList = storageManager.getCachedIssues();
						const updatedIssueList = issueList.map(iss => {
							if (iss.number === message.number) {
								return { ...iss, body: message.body };
							}
							return iss;
						});
						await storageManager.setCachedIssues(updatedIssueList);
						webviewView.webview.postMessage({
							command: 'updateIssueBodyResult',
							success: true,
							number: message.number,
							body: message.body,
							updatedIssues: updatedIssueList
						});
					} else {
						webviewView.webview.postMessage({
							command: 'updateIssueBodyResult',
							success: false,
							number: message.number
						});
					}
					return;
				}
			case 'createIssue': {
					const newIssue = await createGitHubIssue(message.title, message.body);
					if (newIssue) {
						vscode.window.showInformationMessage(`Issue #${newIssue.number} berhasil dibuat di GitHub.`);
						
						// Update cache lokal dengan menyisipkan issue baru di urutan teratas
						const cachedIssues = storageManager.getCachedIssues();
						const updatedIssues = [newIssue, ...cachedIssues];
						await storageManager.setCachedIssues(updatedIssues);

						webviewView.webview.postMessage({
							command: 'createIssueResult',
							success: true,
							issue: newIssue,
							updatedIssues
						});
					} else {
						vscode.window.showWarningMessage("Gagal membuat issue baru di GitHub. Periksa koneksi dan otentikasi.");
						webviewView.webview.postMessage({
							command: 'createIssueResult',
							success: false
						});
					}
					return;
				}
			}
		});
	}

	async refresh(): Promise<void> {
		if (this._view) {
			this._view.webview.postMessage({ command: 'refreshTriggered' });
		}
	}

	private async _getMockAnalysis(number: number, title: string, workspaceFiles: string[]) {
		let files: { filePath: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; reason: string; lineRange?: { start: number; end: number }; targetSymbol?: string }[] = [];
		let summary = "";

		if (number === 101) {
			files = [
				{ filePath: "src/utils/auth.ts", confidence: "HIGH", reason: "Modul utama penanganan otentikasi dan token kedaluwarsa.", lineRange: { start: 45, end: 72 }, targetSymbol: "handleTokenRefresh" },
				{ filePath: "src/components/Login.tsx", confidence: "HIGH", reason: "Menangani tampilan UI formulir login dan memicu redirect.", lineRange: { start: 18, end: 35 }, targetSymbol: "LoginComponent" },
				{ filePath: "package.json", confidence: "LOW", reason: "Mencatat versi dependensi axios / library auth yang digunakan." }
			];
			summary = "Analisis mendeteksi bahwa token kedaluwarsa melempar error status 401 unhandled. Perlu ditambahkan interceptor di `src/utils/auth.ts` untuk menangkap status 401 dan melakukan pengalihan paksa kursor pengguna ke halaman login `/login`.";
		} else if (number === 102) {
			files = [
				{ filePath: "src/utils/auth.ts", confidence: "HIGH", reason: "Perlu ditambahkan konfigurasi Google OAuth Client Provider.", lineRange: { start: 10, end: 30 }, targetSymbol: "OAuthConfig" },
				{ filePath: "src/components/Settings.tsx", confidence: "MEDIUM", reason: "Menambahkan tombol opsi Google login di antarmuka setelan.", lineRange: { start: 55, end: 78 }, targetSymbol: "SettingsPanel" }
			];
			summary = "Penambahan fitur Google OAuth memerlukan integrasi client ID Google di modul otentikasi serta tombol visual baru pada panel pengaturan pengguna.";
		} else if (number === 103) {
			files = [
				{ filePath: "README.md", confidence: "HIGH", reason: "Berkas dokumentasi utama proyek yang kosong.", lineRange: { start: 1, end: 10 } }
			];
			summary = "README.md perlu diisi dengan petunjuk setup proyek seperti `npm install`, pengemasan menggunakan `vsce package`, dan instruksi konfigurasi API Key.";
		} else {
			const defaultFiles = workspaceFiles.length > 0 ? workspaceFiles.slice(0, 2) : ["src/extension.ts"];
			files = defaultFiles.map(f => ({
				filePath: f,
				confidence: "MEDIUM",
				reason: "Berkas kode di workspace yang memiliki keterkaitan dengan komponen struktural proyek."
			}));
			summary = `Analisis AI menunjukkan issue "${title}" dapat diselesaikan dengan memodifikasi modul fungsional di berkas proyek ini.`;
		}

		return { files, summary };
	}

	private _getMockSuggestion(number: number, title: string): string {
		if (number === 101) {
			return "Saya telah menganalisis kegagalan unhandled 401 ini. Saya akan menambahkan interceptor respons pada client API di `src/utils/auth.ts` untuk menangani token kedaluwarsa secara otomatis dan mengalihkan pengguna ke halaman login `/login`. Perubahan kode akan segera saya ajukan.";
		} else if (number === 102) {
			return "Untuk menambahkan Google OAuth, saya telah menyiapkan penyesuaian konfigurasi di `src/utils/auth.ts`. Tombol login Google juga akan saya tambahkan pada komponen `src/components/Settings.tsx` agar pengguna dapat menautkan akun mereka.";
		} else if (number === 103) {
			return "Saya telah memetakan petunjuk lengkap untuk setup, kompilasi build, serta langkah pengemasan ekstensi VS Code. Berkas `README.md` utama akan segera saya perbarui dengan informasi tersebut.";
		}
		return `Terkait masalah "${title}", saya telah meninjau berkas terkait di workspace dan sedang menyiapkan draf perbaikan kodenya.`;
	}

	private _getHtml(webview: vscode.Webview, webviewPath: vscode.Uri): string {
		const bundleJsUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewPath, 'bundle.js'));
		const bundleCssUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewPath, 'bundle.css'));

		const nonce = this._getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<link rel="stylesheet" href="${bundleCssUri}">
	<title>IssueMapper AI</title>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" src="${bundleJsUri}"></script>
</body>
</html>`;
	}

	private _getNonce(): string {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 64; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
}
