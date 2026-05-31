import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface RepositoryInfo {
	owner: string;
	repo: string;
}

/**
 * Mendapatkan daftar path relatif berkas di workspace secara asinkron.
 * Menyaring folder dependensi pihak ketiga, folder kompilasi, serta berkas biner
 * dari berbagai bahasa pemrograman (JS, Python, Go, Rust, Java, C++, dll.).
 */
export async function getWorkspaceFiles(): Promise<string[]> {
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		return [];
	}

	// Pola eksklusi multi-bahasa yang komprehensif:
	// - Web/JS: node_modules, dist, build, out, .next, .nuxt, .cache
	// - Python: venv, .venv, env, .env, __pycache__, .pytest_cache, .ipynb_checkpoints
	// - Rust: target
	// - Java/Kotlin: .gradle, build, bin
	// - Go/Ruby/PHP: vendor, .bundle
	// - Version Control: .git, .svn, .hg
	// - Binary & Assets: Gambar, video, audio, arsip kompresi, berkas executable
	const excludePattern = '{' + [
		'**/node_modules/**', '**/.git/**', '**/.svn/**', '**/.hg/**',
		'**/dist/**', '**/build/**', '**/out/**', '**/bin/**',
		'**/.next/**', '**/.nuxt/**', '**/.cache/**',
		'**/target/**', '**/venv/**', '**/.venv/**', '**/env/**',
		'**/__pycache__/**', '**/.pytest_cache/**', '**/.ipynb_checkpoints/**',
		'**/vendor/**', '**/.bundle/**',
		'**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.svg', '**/*.ico',
		'**/*.webp', '**/*.mp4', '**/*.mp3', '**/*.wav', '**/*.pdf',
		'**/*.zip', '**/*.tar.gz', '**/*.rar', '**/*.7z',
		'**/*.exe', '**/*.dll', '**/*.so', '**/*.dylib', '**/*.dmg'
	].join(',') + '}';
	
	try {
		const files = await vscode.workspace.findFiles('**/*', excludePattern, 1000);
		return files.map(file => vscode.workspace.asRelativePath(file));
	} catch (error) {
		console.error("Gagal melakukan pemindaian workspace berkas:", error);
		return [];
	}
}

/**
 * Mendeteksi owner dan repo GitHub dari remote origin git lokal di workspace aktif.
 * Mengekstrak owner dan repo dari URL origin.
 */
export async function getGitHubRepositoryInfo(): Promise<RepositoryInfo | undefined> {
	try {
		// Cara 1: Menggunakan ekstensi Git bawaan VS Code jika tersedia
		const gitExtension = vscode.extensions.getExtension('vscode.git');
		if (gitExtension) {
			const git = gitExtension.exports.getAPI(1);
			const repositories = git.repositories;
			if (repositories && repositories.length > 0) {
				const repo = repositories[0];
				const remotes = repo.state.remotes;
				const origin = remotes.find((r: any) => r.name === 'origin') || remotes[0];
				if (origin && origin.fetchUrl) {
					const info = parseGitHubUrl(origin.fetchUrl);
					if (info) return info;
				}
			}
		}
	} catch (e) {
		// Lanjut ke Cara 2
	}

	// Cara 2: Membaca berkas .git/config secara manual dari filesystem
	try {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return undefined;
		}

		const rootPath = workspaceFolders[0].uri.fsPath;
		const gitConfigPath = path.join(rootPath, '.git', 'config');

		if (fs.existsSync(gitConfigPath)) {
			const configContent = fs.readFileSync(gitConfigPath, 'utf8');
			// Mencari URL remote origin di dalam git config
			const match = configContent.match(/\[remote\s+"origin"\][^]*?url\s*=\s*(.+)/i);
			if (match && match[1]) {
				const url = match[1].trim();
				return parseGitHubUrl(url);
			}
		}
	} catch (e) {
		// Gagal membaca berkas config
	}

	return undefined;
}

/**
 * Mem-parsing string URL git/github menjadi object { owner, repo }.
 */
function parseGitHubUrl(url: string): RepositoryInfo | undefined {
	const cleanedUrl = url.endsWith('.git') ? url.slice(0, -4) : url;

	const httpsRegex = /github\.com\/([^\/]+)\/([^\/]+)/i;
	const sshRegex = /git@github\.com:([^\/]+)\/([^\/]+)/i;

	const httpsMatch = cleanedUrl.match(httpsRegex);
	if (httpsMatch) {
		return { owner: httpsMatch[1], repo: httpsMatch[2] };
	}

	const sshMatch = cleanedUrl.match(sshRegex);
	if (sshMatch) {
		return { owner: sshMatch[1], repo: sshMatch[2] };
	}

	return undefined;
}
