import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getWorkspaceFiles } from './workspaceScanner';
import { getProjectIgnorePatterns } from '../ai/projectConfig';

interface OllamaEmbeddingResponse {
	embeddings?: number[][];
	embedding?: number[];
}

// Interface for serialized cache entries in workspaceState
export interface IndexedFile {
	filePath: string;
	hash: string;
	vector?: number[];
	tokens?: string[]; // Tokenized representation for TF-IDF fallback
}

// 1. Cosine Similarity helper
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
	if (vecA.length !== vecB.length || vecA.length === 0) {
		return 0;
	}
	let dotProduct = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < vecA.length; i++) {
		dotProduct += vecA[i] * vecB[i];
		normA += vecA[i] * vecA[i];
		normB += vecB[i] * vecB[i];
	}
	if (normA === 0 || normB === 0) {
		return 0;
	}
	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 2. TF-IDF Tokenizer & Search Helper
export class TFIDFSearch {
	private static stopwords = new Set([
		'the', 'a', 'an', 'and', 'or', 'but', 'if', 'else', 'while', 'for', 'return',
		'function', 'class', 'import', 'export', 'const', 'let', 'var', 'from', 'this',
		'public', 'private', 'protected', 'async', 'await', 'new', 'null', 'undefined',
		'true', 'false', 'boolean', 'string', 'number', 'any', 'void', 'module', 'interface',
		'type', 'try', 'catch', 'throw', 'error', 'extends', 'implements', 'package',
		'is', 'in', 'to', 'with', 'some', 'at', 'on', 'by', 'about', 'as'
	]);

	static tokenize(text: string): string[] {
		// Split by camelCase, snake_case, and non-alphanumeric chars
		const words = text
			.replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase split
			.split(/[^a-zA-Z0-9]+/)
			.map(w => w.toLowerCase())
			.filter(w => w.length > 1 && !this.stopwords.has(w));
		return words;
	}

	static search(query: string, indexedFiles: IndexedFile[], maxResults: number = 20): string[] {
		const queryTokens = this.tokenize(query);
		if (queryTokens.length === 0) {
			return indexedFiles.slice(0, maxResults).map(f => f.filePath);
		}

		const docTokensList = indexedFiles.map(f => f.tokens || []);
		const numDocs = indexedFiles.length;

		// Calculate IDF
		const docCounts = new Map<string, number>();
		for (const tokens of docTokensList) {
			const uniqueTokens = new Set(tokens);
			for (const t of uniqueTokens) {
				docCounts.set(t, (docCounts.get(t) || 0) + 1);
			}
		}

		const idfs = new Map<string, number>();
		for (const [t, count] of docCounts.entries()) {
			idfs.set(t, Math.log(1 + (numDocs / count)));
		}

		// Calculate TF-IDF vectors
		const fileScores: { filePath: string; score: number }[] = [];

		for (const file of indexedFiles) {
			const tokens = file.tokens || [];
			if (tokens.length === 0) {
				fileScores.push({ filePath: file.filePath, score: 0 });
				continue;
			}

			// Compute TF for the file
			const tf = new Map<string, number>();
			for (const t of tokens) {
				tf.set(t, (tf.get(t) || 0) + 1);
			}

			// Compute cosine similarity between Query TF-IDF and File TF-IDF
			// Focus only on query tokens to compute dot product efficiently
			let dotProduct = 0;
			let queryNormSq = 0;
			let docNormSq = 0;

			// Compute Query vector norms & dot product
			const queryTf = new Map<string, number>();
			for (const t of queryTokens) {
				queryTf.set(t, (queryTf.get(t) || 0) + 1);
			}

			// Unique query tokens
			const uniqueQueryTokens = Array.from(new Set(queryTokens));
			for (const t of uniqueQueryTokens) {
				const idf = idfs.get(t) || 0;
				const qVal = (queryTf.get(t) || 0) / queryTokens.length * idf;
				queryNormSq += qVal * qVal;

				if (tf.has(t)) {
					const dVal = (tf.get(t) || 0) / tokens.length * idf;
					dotProduct += qVal * dVal;
				}
			}

			// Document full norm (all unique tokens in file)
			const uniqueDocTokens = Array.from(new Set(tokens));
			for (const t of uniqueDocTokens) {
				const idf = idfs.get(t) || 0;
				const dVal = (tf.get(t) || 0) / tokens.length * idf;
				docNormSq += dVal * dVal;
			}

			const similarity = (queryNormSq === 0 || docNormSq === 0)
				? 0
				: dotProduct / (Math.sqrt(queryNormSq) * Math.sqrt(docNormSq));

			// Give minor bonus to match in file name
			let nameBonus = 0;
			const fileName = path.basename(file.filePath).toLowerCase();
			for (const qt of queryTokens) {
				if (fileName.includes(qt)) {
					nameBonus += 0.1;
				}
			}

			fileScores.push({ filePath: file.filePath, score: similarity + nameBonus });
		}

		// Sort and return top files
		return fileScores
			.sort((a, b) => b.score - a.score)
			.slice(0, maxResults)
			.map(item => item.filePath);
	}
}

// 3. Workspace Indexer Manager
export class WorkspaceSemanticIndexer {
	private static STATE_KEY = 'semanticIndexDb';
	private isIndexing = false;

	constructor(private context: vscode.ExtensionContext) {}

	private getOllamaHostUrl(): string {
		return vscode.workspace.getConfiguration('issueMapper').get<string>('ollamaHostUrl') || 
			this.context.globalState.get<string>('ollamaHostUrl') || 
			'http://localhost:11434';
	}

	private getOllamaEmbeddingModel(): string {
		return vscode.workspace.getConfiguration('issueMapper').get<string>('ollamaEmbeddingModel') || 
			'nomic-embed-text';
	}

	private isOllamaEnabled(): boolean {
		const provider = this.context.globalState.get<string>('activeProvider') || 'openai';
		return provider === 'ollama';
	}

	/**
	 * Compute hash of content for dirty check
	 */
	private getHash(content: string): string {
		return crypto.createHash('sha256').update(content).digest('hex');
	}

	/**
	 * Fetch embedding vector from Ollama
	 */
	private async fetchOllamaEmbedding(text: string): Promise<number[] | undefined> {
		const host = this.getOllamaHostUrl();
		const model = this.getOllamaEmbeddingModel();
		
		try {
			// Try /api/embed (newer endpoint)
			const response = await fetch(`${host}/api/embed`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: model,
					input: text
				})
			});

			if (response.ok) {
				const data = await response.json() as OllamaEmbeddingResponse;
				if (data.embeddings && data.embeddings.length > 0) {
					return data.embeddings[0];
				}
			}
		} catch {
			// Fallback to legacy /api/embeddings
		}

		try {
			const response = await fetch(`${host}/api/embeddings`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: model,
					prompt: text
				})
			});

			if (response.ok) {
				const data = await response.json() as OllamaEmbeddingResponse;
				return data.embedding;
			}
		} catch (e) {
			console.warn(`Gagal memanggil Ollama Embedding API untuk model "${model}":`, e);
		}
		return undefined;
	}

	/**
	 * Run the indexing in the background asynchronously
	 */
	public async startIndexingInBackground(): Promise<void> {
		if (this.isIndexing) {
			return;
		}
		this.isIndexing = true;

		try {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				this.isIndexing = false;
				return;
			}

			const rootPath = workspaceFolders[0].uri.fsPath;
			
			// Load config ignore patterns
			const ignorePatterns = getProjectIgnorePatterns();
			const files = await getWorkspaceFiles(ignorePatterns.length > 0 ? ignorePatterns : undefined);

			// Load existing index from cache
			const indexDb: { [filePath: string]: IndexedFile } = this.context.workspaceState.get(WorkspaceSemanticIndexer.STATE_KEY) || {};
			const updatedDb: { [filePath: string]: IndexedFile } = {};
			let changesCount = 0;

			// Limit embedding generation to avoid freeze/infinite loops
			const useOllama = this.isOllamaEnabled();

			for (const relPath of files) {
				const fullPath = path.join(rootPath, relPath);
				if (!fs.existsSync(fullPath)) {
					continue;
				}

				try {
					const stats = fs.statSync(fullPath);
					if (stats.size > 1024 * 512) { // Skip files > 512 KB
						continue;
					}

					const content = fs.readFileSync(fullPath, 'utf8');
					const currentHash = this.getHash(content);
					
					const cached = indexDb[relPath];
					if (cached && cached.hash === currentHash) {
						// Cache hit, reuse it
						updatedDb[relPath] = cached;
						continue;
					}

					// Build descriptive text block for this file
					// Filename + first 1000 characters
					const snippet = content.slice(0, 1000);
					const fileText = `File: ${relPath}\n\nContent:\n${snippet}`;
					
					const entry: IndexedFile = {
						filePath: relPath,
						hash: currentHash,
						tokens: TFIDFSearch.tokenize(fileText)
					};

					if (useOllama) {
						// Fetch vector from Ollama
						const vector = await this.fetchOllamaEmbedding(fileText);
						if (vector) {
							entry.vector = vector;
						}
					}

					updatedDb[relPath] = entry;
					changesCount++;

					// Batch save progress to workspaceState every 20 modifications
					if (changesCount % 20 === 0) {
						await this.context.workspaceState.update(WorkspaceSemanticIndexer.STATE_KEY, updatedDb);
					}
				} catch (fileErr) {
					console.error(`Gagal melakukan indeks berkas ${relPath}:`, fileErr);
				}
			}

			// Final save
			await this.context.workspaceState.update(WorkspaceSemanticIndexer.STATE_KEY, updatedDb);
			console.log(`Pencarian semantik terindeks: ${files.length} berkas (${changesCount} diperbarui).`);
		} catch (err) {
			console.error('Gagal menjalankan indeks latar belakang:', err);
		} finally {
			this.isIndexing = false;
		}
	}

	/**
	 * Retrieve top relevant files using cosine similarity (dense vectors) or TF-IDF (tokens)
	 */
	public async findRelevantFiles(issueTitle: string, issueBody: string, maxResults: number = 15): Promise<string[]> {
		const query = `Title: ${issueTitle}\n\nDescription: ${issueBody}`;
		
		// Load index database
		const indexDb: { [filePath: string]: IndexedFile } = this.context.workspaceState.get(WorkspaceSemanticIndexer.STATE_KEY) || {};
		const indexedFiles = Object.values(indexDb);

		if (indexedFiles.length === 0) {
			// If not indexed yet, return all files
			const ignorePatterns = getProjectIgnorePatterns();
			const files = await getWorkspaceFiles(ignorePatterns.length > 0 ? ignorePatterns : undefined);
			return files.slice(0, maxResults);
		}

		const useOllama = this.isOllamaEnabled();
		if (useOllama) {
			// Try to embed query
			const queryVector = await this.fetchOllamaEmbedding(query);
			if (queryVector) {
				// We have a query vector! Calculate cosine similarity on dense vectors.
				const fileScores: { filePath: string; score: number }[] = [];
				for (const file of indexedFiles) {
					if (file.vector) {
						let similarity = cosineSimilarity(queryVector, file.vector);

						// Match filename keywords for bonus
						let nameBonus = 0;
						const queryTokens = TFIDFSearch.tokenize(query);
						const fileName = path.basename(file.filePath).toLowerCase();
						for (const qt of queryTokens) {
							if (fileName.includes(qt)) {
								nameBonus += 0.1;
							}
						}

						fileScores.push({ filePath: file.filePath, score: similarity + nameBonus });
					} else {
						fileScores.push({ filePath: file.filePath, score: 0 });
					}
				}

				return fileScores
					.sort((a, b) => b.score - a.score)
					.slice(0, maxResults)
					.map(item => item.filePath);
			}
		}

		// Fallback to TF-IDF cosine similarity search
		return TFIDFSearch.search(query, indexedFiles, maxResults);
	}
}
