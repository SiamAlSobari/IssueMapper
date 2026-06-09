import * as vscode from 'vscode';
import { getGitHubRepositoryInfo } from './workspaceScanner';
import { GitHubIssue } from './storageManager';
import { graphql } from '@octokit/graphql';
import { Octokit } from '@octokit/rest';

// Mock issues untuk fallback jika token tidak ada, workspace bukan repo git, atau rate limit terlampaui
const MOCK_ISSUES: GitHubIssue[] = [
	{
		number: 101,
		title: "Bug: Login token expiration throws 401 unhandled exception",
		body: "When the user session expires, clicking refresh crashes the application with a 401 Unauthorized status code instead of redirecting to /login.",
		state: "open",
		author: "Colorful",
		labels: [
			{ name: "bug", color: "d73a4a" },
			{ name: "high-priority", color: "b60205" }
		]
	},
	{
		number: 102,
		title: "Feature: Add Google OAuth option to authentication settings",
		body: "We need to allow users to sign in with Google OAuth directly from the settings panel.",
		state: "open",
		author: "johndoe",
		labels: [
			{ name: "enhancement", color: "a2eeef" }
		]
	},
	{
		number: 103,
		title: "Documentation: Update README with setup and deployment instructions",
		body: "The README file is currently empty. Please write complete steps to install dependencies, run the server, and deploy the VS Code extension.",
		state: "open",
		author: "Colorful",
		labels: [
			{ name: "documentation", color: "0075ca" }
		]
	},
	{
		number: 104,
		title: "Refactor: Move database connections to centralized prisma.ts instance",
		body: "To prevent exceeding PostgreSQL connection pool limit, we should instantiate PrismaClient once and export it from a common lib folder.",
		state: "closed",
		author: "janedoe",
		labels: [
			{ name: "refactor", color: "cfd3d7" }
		]
	}
];

/**
 * Mengambil daftar issue dari GitHub menggunakan GraphQL API.
 * Mengambil hanya kolom esensial: number, title, body, state, dan labels.
 */
export async function fetchGitHubIssues(forceRefresh: boolean = false): Promise<{ issues: GitHubIssue[]; currentUser?: string; fromCache: boolean; repoDetected: boolean; authenticated: boolean }> {
	let authenticated = false;
	let repoDetected = false;

	try {
		// 1. Deteksi informasi repositori aktif
		const repoInfo = await getGitHubRepositoryInfo();
		if (!repoInfo) {
			return {
				issues: MOCK_ISSUES,
				currentUser: 'Colorful',
				fromCache: false,
				repoDetected: false,
				authenticated: false
			};
		}
		repoDetected = true;

		// 2. Dapatkan token otentikasi GitHub secara native
		const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: forceRefresh });
		if (!session) {
			return {
				issues: MOCK_ISSUES,
				currentUser: 'Colorful',
				fromCache: false,
				repoDetected: true,
				authenticated: false
			};
		}
		authenticated = true;

		
		// Gunakan Promise.race dengan timeout 5 detik agar tidak menggantung jika jaringan bermasalah
		const response = await Promise.race([
			graphql<{ repository: { issues: { nodes: { number: number; title: string; body: string | null; state: string; author: { login: string } | null; labels: { nodes: { name: string; color: string }[] } }[] } }; viewer: { login: string } }>(
				`
				query ($owner: String!, $repo: String!, $limit: Int!) {
					viewer {
						login
					}
					repository(owner: $owner, name: $repo) {
						issues(first: $limit, orderBy: {field: CREATED_AT, direction: DESC}) {
							nodes {
								number
								title
								body
								state
								author {
									login
								}
								labels(first: 10) {
									nodes {
										name
										color
									}
								}
							}
						}
					}
				}
				`,
				{
					owner: repoInfo.owner,
					repo: repoInfo.repo,
					limit: 50,
					headers: {
						authorization: `token ${session.accessToken}`
					}
				}
			),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("Timeout memuat data dari GitHub API (5 detik).")), 5000)
			)
		]);

		// 4. Format hasil mapping GraphQL
		if (response && response.repository && response.repository.issues) {
			const currentUser = response.viewer?.login;
		const nodes = response.repository.issues.nodes;
		const issues: GitHubIssue[] = nodes.map((node) => ({
			number: node.number,
			title: node.title,
			body: node.body || '',
			state: node.state.toLowerCase(),
			author: node.author?.login || 'ghost',
			labels: (node.labels?.nodes || []).map((l) => ({
				name: l.name || '',
				color: l.color || 'cfd3d7'
			}))
		}));

			return {
				issues,
				currentUser,
				fromCache: false,
				repoDetected: true,
				authenticated: true
			};
		}

		return {
			issues: MOCK_ISSUES,
			currentUser: 'Colorful',
			fromCache: false,
			repoDetected: true,
			authenticated: true
		};

	} catch (error) {
		console.error("Gagal memuat issue dari GitHub GraphQL API:", error);
		return {
			issues: MOCK_ISSUES,
			currentUser: 'Colorful',
			fromCache: false,
			repoDetected: repoDetected,
			authenticated: authenticated
		};
	}
}

/**
 * Mengirimkan komentar baru ke issue GitHub tertentu menggunakan REST API.
 * POST /repos/{owner}/{repo}/issues/{issue_number}/comments
 */
export async function postGitHubComment(issueNumber: number, body: string): Promise<boolean> {
	try {
		const repoInfo = await getGitHubRepositoryInfo();
		if (!repoInfo) { return false; }

		const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
		if (!session) { return false; }


		const octokit = new Octokit({ auth: session.accessToken });

		await octokit.issues.createComment({
			owner: repoInfo.owner,
			repo: repoInfo.repo,
			issue_number: issueNumber,
			body
		});
		return true;
	} catch (error) {
		console.error(`Gagal memposting komentar ke issue #${issueNumber}:`, error);
		return false;
	}
}

/**
 * Mengubah status issue GitHub (membuka/menutup) menggunakan REST API.
 * PATCH /repos/{owner}/{repo}/issues/{issue_number}
 */
export async function updateGitHubIssueState(issueNumber: number, state: 'open' | 'closed'): Promise<boolean> {
	try {
		const repoInfo = await getGitHubRepositoryInfo();
		if (!repoInfo) { return false; }

		const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
		if (!session) { return false; }


		const octokit = new Octokit({ auth: session.accessToken });

		await octokit.issues.update({
			owner: repoInfo.owner,
			repo: repoInfo.repo,
			issue_number: issueNumber,
			state
		});
		return true;
	} catch (error) {
		console.error(`Gagal mengubah status issue #${issueNumber} menjadi ${state}:`, error);
		return false;
	}
}

/**
 * Membuat issue baru di GitHub menggunakan REST API.
 * POST /repos/{owner}/{repo}/issues
 */
/**
 * Memperbarui body/deskripsi issue GitHub menggunakan REST API.
 * PATCH /repos/{owner}/{repo}/issues/{issue_number}
 */
export async function updateGitHubIssueBody(issueNumber: number, body: string): Promise<boolean> {
	try {
		const repoInfo = await getGitHubRepositoryInfo();
		if (!repoInfo) { return false; }

		const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
		if (!session) { return false; }


		const octokit = new Octokit({ auth: session.accessToken });

		await octokit.issues.update({
			owner: repoInfo.owner,
			repo: repoInfo.repo,
			issue_number: issueNumber,
			body
		});
		return true;
	} catch (error) {
		console.error(`Gagal memperbarui body issue #${issueNumber}:`, error);
		return false;
	}
}

export async function createGitHubIssue(title: string, body: string): Promise<GitHubIssue | null> {
	try {
		const repoInfo = await getGitHubRepositoryInfo();
		if (!repoInfo) { return null; }

		const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
		if (!session) { return null; }


		const octokit = new Octokit({ auth: session.accessToken });

		const response = await octokit.issues.create({
			owner: repoInfo.owner,
			repo: repoInfo.repo,
			title,
			body
		});

		// Dapatkan username authenticated user
		let username = 'ghost';
		try {
			const userRes = await octokit.users.getAuthenticated();
			username = userRes.data.login;
		} catch (uErr) {
			console.error("Gagal mendapatkan username terotentikasi:", uErr);
		}

		return {
			number: response.data.number,
			title: response.data.title,
			body: response.data.body || '',
			state: response.data.state,
			author: username,
			labels: response.data.labels.map((l: Record<string, unknown> | string) => ({
				name: typeof l === 'string' ? l : ((l as Record<string, unknown>).name as string || ''),
				color: typeof l === 'string' ? 'cfd3d7' : ((l as Record<string, unknown>).color as string || 'cfd3d7')
			}))
		};
	} catch (error) {
		console.error("Gagal membuat issue baru:", error);
		return null;
	}
}
