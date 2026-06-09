import * as vscode from 'vscode';
import { GitContext } from '../utils/workspaceScanner';
import { loadProjectConfig, formatProjectConfig, ProjectConfig } from './projectConfig';
import { buildCodeFixPrompt, parseCodeFixResponse, CodeFixRequest, CodeFixResponse } from './codeFixPrompt';

export interface LineRange {
	start: number;
	end: number;
}

export interface AIResponse {
	files: { filePath: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; reason: string; lineRange?: LineRange; targetSymbol?: string }[];
	summary: string;
}

interface OpenAIResponse {
	choices: { message: { content: string } }[];
}
interface GeminiResponse {
	candidates: { content: { parts: { text: string }[] } }[];
}
interface GroqResponse {
	choices: { message: { content: string } }[];
}
interface OllamaChatResponse {
	message: { content: string };
}

/**
 * Mengurai string JSON respons AI secara tangguh (robust JSON parser).
 * Membersihkan format blok kode markdown dan melakukan penormalan/validasi struktur.
 */
export function parseAIResponse(text: string): AIResponse {
	let cleanText = text.trim();
	
	// Hapus pembungkus markdown block ```json ... ``` jika ada
	if (cleanText.startsWith('```')) {
		cleanText = cleanText.replace(/^```(?:json)?\s*/i, '');
		cleanText = cleanText.replace(/\s*```$/, '');
	}
	cleanText = cleanText.trim();

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(cleanText) as Record<string, unknown>;
	} catch {
		// Jika gagal parse langsung, coba cari JSON terluar dengan regex
		const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			try {
				parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
			} catch (innerError) {
				console.error("Gagal mengurai JSON dengan pencocokan regex terluar:", cleanText);
				throw new Error(`Respons dari AI bukan JSON yang valid. Gagal parsing.`);
			}
		} else {
			console.error("Gagal mengurai JSON, tidak ditemukan tanda kurung kurawal:", cleanText);
			throw new Error(`Respons dari AI bukan JSON yang valid.`);
		}
	}

	// Normalisasi dan validasi struktur AIResponse
	const files: Record<string, unknown>[] = Array.isArray(parsed.files) ? (parsed.files as Record<string, unknown>[]) : [];
	const summary: string = typeof parsed.summary === 'string' ? parsed.summary : '';

	const formattedFiles = files.map((f: Record<string, unknown>) => {
		let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
		if (f.confidence === 'HIGH' || f.confidence === 'LOW' || f.confidence === 'MEDIUM') {
			confidence = f.confidence;
		} else if (typeof f.confidence === 'string') {
			const upper = f.confidence.toUpperCase();
			if (upper === 'HIGH' || upper === 'MEDIUM' || upper === 'LOW') {
				confidence = upper as 'HIGH' | 'MEDIUM' | 'LOW';
			}
		}

		let lineRange: LineRange | undefined = undefined;
		const rawLineRange = f.lineRange;
		if (rawLineRange && typeof rawLineRange === 'object') {
			const lr = rawLineRange as Record<string, unknown>;
			const start = typeof lr.start === 'number' && lr.start > 0 ? lr.start : undefined;
			const end = typeof lr.end === 'number' && lr.end > 0 ? lr.end : undefined;
			if (start !== undefined && end !== undefined && end >= start) {
				lineRange = { start, end };
			}
		}

		return {
			filePath: typeof f.filePath === 'string' ? f.filePath : '',
			confidence,
			reason: typeof f.reason === 'string' ? f.reason : '',
			lineRange,
			targetSymbol: typeof f.targetSymbol === 'string' ? f.targetSymbol : undefined
		};
	}).filter(f => f.filePath !== '');

	return {
		files: formattedFiles,
		summary
	};
}

export interface IAIProvider {
	analyzeIssue(issueTitle: string, issueDesc: string, filePaths: string[], gitContext?: GitContext): Promise<AIResponse>;
	generateReply(issueDesc: string, currentCodeContext: string): Promise<string>;
	generateCodeFix(request: CodeFixRequest): Promise<CodeFixResponse>;
}

/**
 * Memuat konfigurasi proyek (.issuemaprc / .issue-mapper.json) dan menyusunnya
 * menjadi blok teks yang siap disisipkan ke dalam System Prompt AI.
 */
async function buildProjectRulesBlock(): Promise<string> {
	try {
		const config: ProjectConfig | null = await loadProjectConfig();
		if (!config) {
			return '';
		}

		const formatted = formatProjectConfig(config);
		if (!formatted) {
			return '';
		}

		return `\n\n---\nAturan & Panduan Proyek Lokal:\n${formatted}`;
	} catch {
		return '';
	}
}

/**
 * Memformat objek GitContext menjadi string ringkas untuk disisipkan ke prompt LLM.
 */
function formatGitContext(gitContext?: GitContext): string {
	if (!gitContext || !gitContext.activeBranch) {
		return '';
	}

	let lines: string[] = [];
	lines.push(`- Branch Aktif: ${gitContext.activeBranch}`);

	if (gitContext.unstagedFiles.length > 0) {
		lines.push(`- Berkas Unstaged/Belum Dikomit:`);
		for (const f of gitContext.unstagedFiles.slice(0, 30)) {
			lines.push(`  - ${f}`);
		}
	}

	if (gitContext.recentCommits.length > 0) {
		lines.push(`- Riwayat 5 Komit Terakhir:`);
		for (const c of gitContext.recentCommits) {
			const fileList = c.files.length > 0 ? ` → [${c.files.join(', ')}]` : '';
			lines.push(`  - ${c.hash} "${c.message}"${fileList}`);
		}
	}

	return lines.join('\n');
}

/**
 * Helper untuk menjalankan request API dengan mekanisme Dynamic Model Fallback.
 * Mencoba daftar model secara berurutan jika menemui error Rate Limit (429) atau Timeout/Server Error (5xx).
 */
async function executeWithFallback<T>(
	providerName: string,
	models: string[],
	requestFn: (model: string, signal: AbortSignal) => Promise<T>
): Promise<T> {
	let lastError: Error | null = null;

	for (let i = 0; i < models.length; i++) {
		const currentModel = models[i];
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 7000);
		console.log(`[${providerName}] Mencoba model: ${currentModel}`);
		
		try {
			const result = await requestFn(currentModel, controller.signal);
			clearTimeout(timeoutId);
			console.log(`[${providerName}] Berhasil menggunakan model: ${currentModel}`);
			return result;
		} catch (error: unknown) {
			clearTimeout(timeoutId);
			const err = error instanceof Error ? error : new Error(String(error));
			lastError = err;
			const isRateLimit = (err as { status?: number }).status === 429 || err.message?.includes('429');
			const isServerError = (err as { status?: number }).status !== undefined && (err as { status?: number }).status! >= 500 || err.message?.includes('50') || err.message?.includes('timeout') || err.message?.includes('abort');
			
			console.warn(`[${providerName}] Gagal dengan model ${currentModel}: ${err.message}`);
			
			if (i < models.length - 1 && (isRateLimit || isServerError)) {
				// Berikan notifikasi senyap di status bar VS Code mengenai fallback
				vscode.window.setStatusBarMessage(
					`[${providerName}] ${currentModel} sibuk/limit. Beralih ke model cadangan: ${models[i+1]}...`, 
					4000
				);
				// Lanjut ke iterasi model berikutnya
				continue;
			}
			
			// Jika model terakhir gagal atau error bukan karena overload/rate limit, hentikan
			break;
		}
	}

	throw lastError ?? new Error(`[${providerName}] Semua model gagal diakses.`);
}

/**
 * 1. OpenAI Provider Adapter dengan Fallback
 */
export class OpenAIProvider implements IAIProvider {
	private models: string[];

	constructor(private apiKey: string, preferredModel: string = 'gpt-4o') {
		// Mengatur rantai fallback model OpenAI
		this.models = preferredModel === 'gpt-4o' ? ['gpt-4o', 'gpt-4o-mini'] : [preferredModel, 'gpt-4o-mini'];
	}

	async analyzeIssue(issueTitle: string, issueDesc: string, filePaths: string[], gitContext?: GitContext): Promise<AIResponse> {
		return executeWithFallback('OpenAI', this.models, async (model, signal) => {
			const gitSection = formatGitContext(gitContext);
			const gitBlock = gitSection
				? `\n\nKonteks Git Lokal (Status Repositori):\n${gitSection}`
				: '';

			const projectRulesBlock = await buildProjectRulesBlock();

			const systemPrompt = `You are an expert developer assistant.${projectRulesBlock}`;

			const prompt = `Anda adalah asisten triase kode ahli. Tugas Anda adalah menganalisis deskripsi issue GitHub dan mencocokkannya dengan daftar berkas relatif workspace proyek untuk menemukan lokasi bug. Untuk setiap berkas yang direkomendasikan, estimasikan juga rentang baris (line range) yang kemungkinan berisi masalah dan nama simbol/fungsi terkait jika memungkinkan.

GitHub Issue:
Title: ${issueTitle}
Description: ${issueDesc}

Daftar Berkas Workspace:
${JSON.stringify(filePaths, null, 2)}${gitBlock}

Kembalikan jawaban secara eksklusif dalam format JSON objek terstruktur dengan skema berikut:
{
  "files": [
    {
      "filePath": "relative/path/to/file.ts",
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "reason": "Alasan singkat mengapa berkas ini relevan dengan issue tersebut",
      "lineRange": { "start": <nomor_baris_awal>, "end": <nomor_baris_akhir> },
      "targetSymbol": "<nama fungsi, variabel, atau kelas yang relevan>"
    }
  ],
  "summary": "Analisis ringkas masalah dalam 1-2 kalimat"
}

Catatan: "lineRange" dan "targetSymbol" bersifat opsional. Jika Anda tidak yakin dengan lokasi baris spesifik, cukup hilangkan field "lineRange" atau set null. Nomor baris harus berupa integer positif dimulai dari 1.`;

			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.apiKey}`
				},
				signal,
				body: JSON.stringify({
					model: model,
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: prompt }
					],
					response_format: { type: "json_object" },
					temperature: 0.2
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw Object.assign(new Error(`OpenAI API Error: ${errText}`), { status: response.status });
			}

			const data = await response.json() as OpenAIResponse;
			const content = data.choices[0].message.content;
			return parseAIResponse(content);
		});
	}

	async generateReply(issueDesc: string, currentCodeContext: string): Promise<string> {
		return executeWithFallback('OpenAI', this.models, async (model, signal) => {
			const projectRulesBlock = await buildProjectRulesBlock();
			const systemPrompt = `You are an expert developer assistant writing a friendly and technical GitHub reply.${projectRulesBlock}`;

			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.apiKey}`
				},
				signal,
				body: JSON.stringify({
					model: model,
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: `Tulis draf balasan teknis yang sopan untuk issue GitHub berikut berdasarkan konteks kode proyek saat ini.\n\nGitHub Issue:\n${issueDesc}\n\nKonteks Kode Aktif:\n${currentCodeContext}` }
					],
					temperature: 0.7
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw Object.assign(new Error(`OpenAI API Error: ${errText}`), { status: response.status });
			}

			const data = await response.json() as OpenAIResponse;
			return data.choices[0].message.content.trim();
		});
	}

	async generateCodeFix(request: CodeFixRequest): Promise<CodeFixResponse> {
		return executeWithFallback('OpenAI', this.models, async (model, signal) => {
			const projectRulesBlock = await buildProjectRulesBlock();
			const systemPrompt = `You are an expert code fix engineer. You generate precise, minimal code patches.${projectRulesBlock}`;
			const prompt = buildCodeFixPrompt({ ...request, projectRules: projectRulesBlock || undefined });

			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.apiKey}`
				},
				signal,
				body: JSON.stringify({
					model: model,
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: prompt }
					],
					response_format: { type: "json_object" },
					temperature: 0.1
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw Object.assign(new Error(`OpenAI API Error: ${errText}`), { status: response.status });
			}

			const data = await response.json() as OpenAIResponse;
			const content = data.choices[0].message.content;
			return parseCodeFixResponse(content);
		});
	}
}

/**
 * 2. Google Gemini Provider Adapter dengan Fallback Berantai
 */
export class GeminiProvider implements IAIProvider {
	private models: string[];

	constructor(private apiKey: string, preferredModel: string = 'gemini-3-flash') {
		// Rantai fallback Google Gemini
		const geminiChain = ["gemini-3-flash", "gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"];
		this.models = geminiChain.includes(preferredModel) 
			? [preferredModel, ...geminiChain.filter(m => m !== preferredModel)]
			: [preferredModel, ...geminiChain];
	}

	async analyzeIssue(issueTitle: string, issueDesc: string, filePaths: string[], gitContext?: GitContext): Promise<AIResponse> {
		return executeWithFallback('Gemini', this.models, async (model, signal) => {
			const gitSection = formatGitContext(gitContext);
			const gitBlock = gitSection
				? `\n\nKonteks Git Lokal (Status Repositori):\n${gitSection}`
				: '';

			const projectRulesBlock = await buildProjectRulesBlock();

			const systemInstruction = `You are an expert developer assistant.${projectRulesBlock}`;

			const prompt = `Anda adalah asisten triase kode ahli. Tugas Anda adalah menganalisis deskripsi issue GitHub dan mencocokkannya dengan daftar berkas relatif workspace proyek untuk menemukan lokasi bug. Untuk setiap berkas yang direkomendasikan, estimasikan juga rentang baris (line range) yang kemungkinan berisi masalah dan nama simbol/fungsi terkait jika memungkinkan.

GitHub Issue:
Title: ${issueTitle}
Description: ${issueDesc}

Daftar Berkas Workspace:
${JSON.stringify(filePaths, null, 2)}${gitBlock}

Kembalikan jawaban secara eksklusif dalam format JSON objek terstruktur dengan skema berikut:
{
  "files": [
    {
      "filePath": "relative/path/to/file.ts",
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "reason": "Alasan singkat mengapa berkas ini relevan dengan issue tersebut",
      "lineRange": { "start": <nomor_baris_awal>, "end": <nomor_baris_akhir> },
      "targetSymbol": "<nama fungsi, variabel, atau kelas yang relevan>"
    }
  ],
  "summary": "Analisis ringkas masalah dalam 1-2 kalimat"
}

Catatan: "lineRange" dan "targetSymbol" bersifat opsional. Jika Anda tidak yakin dengan lokasi baris spesifik, cukup hilangkan field "lineRange" atau set null. Nomor baris harus berupa integer positif dimulai dari 1.`;

			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				signal,
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					systemInstruction: { parts: [{ text: systemInstruction }] },
					generationConfig: {
						responseMimeType: "application/json",
						temperature: 0.2
					}
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw Object.assign(new Error(`Gemini API Error: ${errText}`), { status: response.status });
			}

			const data = await response.json() as GeminiResponse;
			const content = data.candidates[0].content.parts[0].text;
			return parseAIResponse(content);
		});
	}

	async generateReply(issueDesc: string, currentCodeContext: string): Promise<string> {
		return executeWithFallback('Gemini', this.models, async (model, signal) => {
			const projectRulesBlock = await buildProjectRulesBlock();
			const systemInstruction = `You are an expert developer assistant writing a friendly and technical GitHub reply.${projectRulesBlock}`;

			const prompt = `Tulis draf balasan teknis yang sopan untuk issue GitHub berikut berdasarkan konteks kode proyek saat ini.\n\nGitHub Issue:\n${issueDesc}\n\nKonteks Kode Aktif:\n${currentCodeContext}`;
			
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				signal,
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					systemInstruction: { parts: [{ text: systemInstruction }] },
					generationConfig: {
						temperature: 0.7
					}
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw Object.assign(new Error(`Gemini API Error: ${errText}`), { status: response.status });
			}

			const data = await response.json() as GeminiResponse;
			return data.candidates[0].content.parts[0].text.trim();
		});
	}

	async generateCodeFix(request: CodeFixRequest): Promise<CodeFixResponse> {
		return executeWithFallback('Gemini', this.models, async (model, signal) => {
			const projectRulesBlock = await buildProjectRulesBlock();
			const systemInstruction = `You are an expert code fix engineer. You generate precise, minimal code patches.${projectRulesBlock}`;
			const prompt = buildCodeFixPrompt({ ...request, projectRules: projectRulesBlock || undefined });

			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				signal,
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					systemInstruction: { parts: [{ text: systemInstruction }] },
					generationConfig: {
						responseMimeType: "application/json",
						temperature: 0.1
					}
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw Object.assign(new Error(`Gemini API Error: ${errText}`), { status: response.status });
			}

			const data = await response.json() as GeminiResponse;
			const content = data.candidates[0].content.parts[0].text;
			return parseCodeFixResponse(content);
		});
	}
}

/**
 * 3. Groq Provider Adapter dengan Fallback Berantai (Kompatibel OpenAI SDK)
 */
export class GroqProvider implements IAIProvider {
	private models: string[];

	constructor(private apiKey: string, preferredModel: string = 'deepseek-r1-distill-llama-70b') {
		// Rantai fallback Groq
		const groqChain = ["deepseek-r1-distill-llama-70b", "llama-4-scout-17b-16e-instruct", "mixtral-8x7b-32768", "llama3-8b-8192"];
		this.models = groqChain.includes(preferredModel)
			? [preferredModel, ...groqChain.filter(m => m !== preferredModel)]
			: [preferredModel, ...groqChain];
	}

	async analyzeIssue(issueTitle: string, issueDesc: string, filePaths: string[], gitContext?: GitContext): Promise<AIResponse> {
		return executeWithFallback('Groq', this.models, async (model, signal) => {
			const gitSection = formatGitContext(gitContext);
			const gitBlock = gitSection
				? `\n\nKonteks Git Lokal (Status Repositori):\n${gitSection}`
				: '';

			const projectRulesBlock = await buildProjectRulesBlock();

			const systemPrompt = `You are an expert developer assistant.${projectRulesBlock}`;

			const prompt = `Anda adalah asisten triase kode ahli. Tugas Anda adalah menganalisis deskripsi issue GitHub dan mencocokkannya dengan daftar berkas relatif workspace proyek untuk menemukan lokasi bug. Untuk setiap berkas yang direkomendasikan, estimasikan juga rentang baris (line range) yang kemungkinan berisi masalah dan nama simbol/fungsi terkait jika memungkinkan.

GitHub Issue:
Title: ${issueTitle}
Description: ${issueDesc}

Daftar Berkas Workspace:
${JSON.stringify(filePaths, null, 2)}${gitBlock}

Kembalikan jawaban secara eksklusif dalam format JSON objek terstruktur dengan skema berikut:
{
  "files": [
    {
      "filePath": "relative/path/to/file.ts",
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "reason": "Alasan singkat mengapa berkas ini relevan dengan issue tersebut",
      "lineRange": { "start": <nomor_baris_awal>, "end": <nomor_baris_akhir> },
      "targetSymbol": "<nama fungsi, variabel, atau kelas yang relevan>"
    }
  ],
  "summary": "Analisis ringkas masalah dalam 1-2 kalimat"
}

Catatan: "lineRange" dan "targetSymbol" bersifat opsional. Jika Anda tidak yakin dengan lokasi baris spesifik, cukup hilangkan field "lineRange" atau set null. Nomor baris harus berupa integer positif dimulai dari 1.`;

			const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.apiKey}`
				},
				signal,
				body: JSON.stringify({
					model: model,
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: prompt }
					],
					response_format: { type: "json_object" },
					temperature: 0.2
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw Object.assign(new Error(`Groq API Error: ${errText}`), { status: response.status });
			}

			const data = await response.json() as GroqResponse;
			const content = data.choices[0].message.content;
			return parseAIResponse(content);
		});
	}

	async generateReply(issueDesc: string, currentCodeContext: string): Promise<string> {
		return executeWithFallback('Groq', this.models, async (model, signal) => {
			const projectRulesBlock = await buildProjectRulesBlock();
			const systemPrompt = `You are an expert developer assistant writing a friendly and technical GitHub reply.${projectRulesBlock}`;

			const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.apiKey}`
				},
				signal,
				body: JSON.stringify({
					model: model,
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: `Tulis draf balasan teknis yang sopan untuk issue GitHub berikut berdasarkan konteks kode proyek saat ini.\n\nGitHub Issue:\n${issueDesc}\n\nKonteks Kode Aktif:\n${currentCodeContext}` }
					],
					temperature: 0.7
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw Object.assign(new Error(`Groq API Error: ${errText}`), { status: response.status });
			}

			const data = await response.json() as GroqResponse;
			return data.choices[0].message.content.trim();
		});
	}

	async generateCodeFix(request: CodeFixRequest): Promise<CodeFixResponse> {
		return executeWithFallback('Groq', this.models, async (model, signal) => {
			const projectRulesBlock = await buildProjectRulesBlock();
			const systemPrompt = `You are an expert code fix engineer. You generate precise, minimal code patches.${projectRulesBlock}`;
			const prompt = buildCodeFixPrompt({ ...request, projectRules: projectRulesBlock || undefined });

			const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.apiKey}`
				},
				signal,
				body: JSON.stringify({
					model: model,
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: prompt }
					],
					response_format: { type: "json_object" },
					temperature: 0.1
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw Object.assign(new Error(`Groq API Error: ${errText}`), { status: response.status });
			}

			const data = await response.json() as GroqResponse;
			const content = data.choices[0].message.content;
			return parseCodeFixResponse(content);
		});
	}
}

/**
 * 4. Ollama Provider Adapter (Koneksi Lokal)
 */
export class OllamaProvider implements IAIProvider {
	constructor(private hostUrl: string = 'http://localhost:11434', private model: string = 'llama3') {}

	async analyzeIssue(issueTitle: string, issueDesc: string, filePaths: string[], gitContext?: GitContext): Promise<AIResponse> {
		return executeWithFallback('Ollama', [this.model], async (model, signal) => {
			const gitSection = formatGitContext(gitContext);
			const gitBlock = gitSection
				? `\n\nKonteks Git Lokal (Status Repositori):\n${gitSection}`
				: '';

			const projectRulesBlock = await buildProjectRulesBlock();
			const systemPrefix = `You are an expert developer assistant.${projectRulesBlock}\n\n`;

			const prompt = `${systemPrefix}Anda adalah asisten triase kode ahli. Tugas Anda adalah menganalisis deskripsi issue GitHub dan mencocokkannya dengan daftar berkas relatif workspace proyek untuk menemukan lokasi bug. Untuk setiap berkas yang direkomendasikan, estimasikan juga rentang baris (line range) yang kemungkinan berisi masalah dan nama simbol/fungsi terkait jika memungkinkan.

GitHub Issue:
Title: ${issueTitle}
Description: ${issueDesc}

Daftar Berkas Workspace:
${JSON.stringify(filePaths, null, 2)}${gitBlock}

Kembalikan jawaban secara eksklusif dalam format JSON objek terstruktur dengan skema berikut:
{
  "files": [
    {
      "filePath": "relative/path/to/file.ts",
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "reason": "Alasan singkat berkas ini relevan",
      "lineRange": { "start": <nomor_baris_awal>, "end": <nomor_baris_akhir> },
      "targetSymbol": "<nama fungsi, variabel, atau kelas yang relevan>"
    }
  ],
  "summary": "Analisis ringkas masalah dalam 1-2 kalimat"
}

Catatan: "lineRange" dan "targetSymbol" bersifat opsional. Jika Anda tidak yakin dengan lokasi baris spesifik, cukup hilangkan field "lineRange" atau set null. Nomor baris harus berupa integer positif dimulai dari 1.`;

			const response = await fetch(`${this.hostUrl}/api/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal,
				body: JSON.stringify({
					model: model,
					messages: [{ role: 'user', content: prompt }],
					format: 'json',
					stream: false
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw Object.assign(new Error(`Ollama Error: ${errText}`), { status: response.status });
			}

			const data = await response.json() as OllamaChatResponse;
			const content = data.message.content;
			return parseAIResponse(content);
		});
	}

	async generateReply(issueDesc: string, currentCodeContext: string): Promise<string> {
		return executeWithFallback('Ollama', [this.model], async (model, signal) => {
			const projectRulesBlock = await buildProjectRulesBlock();
			const systemPrefix = `You are an expert developer assistant writing a friendly and technical GitHub reply.${projectRulesBlock}\n\n`;

			const response = await fetch(`${this.hostUrl}/api/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal,
				body: JSON.stringify({
					model: model,
					messages: [{ 
						role: 'user', 
						content: `${systemPrefix}Tulis draf balasan teknis yang sopan untuk issue GitHub berikut berdasarkan konteks kode proyek saat ini.\n\nGitHub Issue:\n${issueDesc}\n\nKonteks Kode Aktif:\n${currentCodeContext}` 
					}],
					stream: false
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw Object.assign(new Error(`Ollama Error: ${errText}`), { status: response.status });
			}

			const data = await response.json() as OllamaChatResponse;
			return data.message.content.trim();
		});
	}

	async generateCodeFix(request: CodeFixRequest): Promise<CodeFixResponse> {
		return executeWithFallback('Ollama', [this.model], async (model, signal) => {
			const projectRulesBlock = await buildProjectRulesBlock();
			const systemPrefix = `You are an expert code fix engineer. You generate precise, minimal code patches.${projectRulesBlock}\n\n`;
			const prompt = `${systemPrefix}${buildCodeFixPrompt({ ...request, projectRules: projectRulesBlock || undefined })}`;

			const response = await fetch(`${this.hostUrl}/api/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal,
				body: JSON.stringify({
					model: model,
					messages: [{ role: 'user', content: prompt }],
					format: 'json',
					stream: false
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw Object.assign(new Error(`Ollama Error: ${errText}`), { status: response.status });
			}

			const data = await response.json() as OllamaChatResponse;
			const content = data.message.content;
			return parseCodeFixResponse(content);
		});
	}
}

/**
 * 5. Factory untuk membuat Provider secara dinamis
 */
export class AIProviderFactory {
	static create(
		providerType: 'openai' | 'gemini' | 'groq' | 'ollama',
		apiKey: string,
		model?: string,
		hostUrl?: string
	): IAIProvider {
		switch (providerType) {
			case 'openai':
				return new OpenAIProvider(apiKey, model || 'gpt-4o');
			case 'gemini':
				return new GeminiProvider(apiKey, model || 'gemini-3-flash');
			case 'groq':
				return new GroqProvider(apiKey, model || 'deepseek-r1-distill-llama-70b');
			case 'ollama':
				return new OllamaProvider(hostUrl || 'http://localhost:11434', model || 'llama3');
			default:
				throw new Error(`Provider "${providerType}" tidak dikenal.`);
		}
	}
}
