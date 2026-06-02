import * as vscode from 'vscode';

export interface AIResponse {
	files: { filePath: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; reason: string }[];
	summary: string;
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

	let parsed: any;
	try {
		parsed = JSON.parse(cleanText);
	} catch (e) {
		// Jika gagal parse langsung, coba cari JSON terluar dengan regex
		const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			try {
				parsed = JSON.parse(jsonMatch[0]);
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
	const files: any[] = Array.isArray(parsed.files) ? parsed.files : [];
	const summary: string = typeof parsed.summary === 'string' ? parsed.summary : '';

	const formattedFiles = files.map((f: any) => {
		let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
		if (f.confidence === 'HIGH' || f.confidence === 'LOW' || f.confidence === 'MEDIUM') {
			confidence = f.confidence;
		} else if (typeof f.confidence === 'string') {
			const upper = f.confidence.toUpperCase();
			if (upper === 'HIGH' || upper === 'MEDIUM' || upper === 'LOW') {
				confidence = upper as any;
			}
		}
		return {
			filePath: typeof f.filePath === 'string' ? f.filePath : '',
			confidence,
			reason: typeof f.reason === 'string' ? f.reason : ''
		};
	}).filter(f => f.filePath !== '');

	return {
		files: formattedFiles,
		summary
	};
}

export interface IAIProvider {
	analyzeIssue(issueTitle: string, issueDesc: string, filePaths: string[]): Promise<AIResponse>;
	generateReply(issueDesc: string, currentCodeContext: string): Promise<string>;
}

/**
 * Helper untuk menjalankan request API dengan mekanisme Dynamic Model Fallback.
 * Mencoba daftar model secara berurutan jika menemui error Rate Limit (429) atau Timeout/Server Error (5xx).
 */
async function executeWithFallback<T>(
	providerName: string,
	models: string[],
	requestFn: (model: string) => Promise<T>
): Promise<T> {
	let lastError: Error | null = null;

	for (let i = 0; i < models.length; i++) {
		const currentModel = models[i];
		console.log(`[${providerName}] Mencoba model: ${currentModel}`);
		
		try {
			// Jalankan request dengan timeout 7 detik per percobaan model
			const result = await Promise.race([
				requestFn(currentModel),
				new Promise<never>((_, reject) => 
					setTimeout(() => reject(new Error(`Timeout batas waktu request (7 detik) terlampaui.`)), 7000)
				)
			]);
			
			console.log(`[${providerName}] Berhasil menggunakan model: ${currentModel}`);
			return result;
		} catch (error: any) {
			lastError = error;
			const isRateLimit = error.status === 429 || error.message?.includes('429');
			const isServerError = error.status >= 500 || error.message?.includes('50') || error.message?.includes('timeout');
			
			console.warn(`[${providerName}] Gagal dengan model ${currentModel}: ${error.message}`);
			
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

	async analyzeIssue(issueTitle: string, issueDesc: string, filePaths: string[]): Promise<AIResponse> {
		return executeWithFallback('OpenAI', this.models, async (model) => {
			const prompt = `Anda adalah asisten triase kode ahli. Tugas Anda adalah menganalisis deskripsi issue GitHub dan mencocokkannya dengan daftar berkas relatif workspace proyek untuk menemukan lokasi bug.

GitHub Issue:
Title: ${issueTitle}
Description: ${issueDesc}

Daftar Berkas Workspace:
${JSON.stringify(filePaths, null, 2)}

Kembalikan jawaban secara eksklusif dalam format JSON objek terstruktur dengan skema berikut:
{
  "files": [
    {
      "filePath": "relative/path/to/file.ts",
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "reason": "Alasan singkat mengapa berkas ini relevan dengan issue tersebut"
    }
  ],
  "summary": "Analisis ringkas masalah dalam 1-2 kalimat"
}`;

			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.apiKey}`
				},
				body: JSON.stringify({
					model: model,
					messages: [
						{ role: 'system', content: 'You are an expert developer assistant.' },
						{ role: 'user', content: prompt }
					],
					response_format: { type: "json_object" },
					temperature: 0.2
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw { status: response.status, message: `OpenAI API Error: ${errText}` };
			}

			const data = await response.json() as any;
			const content = data.choices[0].message.content;
			return parseAIResponse(content);
		});
	}

	async generateReply(issueDesc: string, currentCodeContext: string): Promise<string> {
		return executeWithFallback('OpenAI', this.models, async (model) => {
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.apiKey}`
				},
				body: JSON.stringify({
					model: model,
					messages: [
						{ role: 'system', content: 'You are an expert developer assistant writing a friendly and technical GitHub reply.' },
						{ role: 'user', content: `Tulis draf balasan teknis yang sopan untuk issue GitHub berikut berdasarkan konteks kode proyek saat ini.\n\nGitHub Issue:\n${issueDesc}\n\nKonteks Kode Aktif:\n${currentCodeContext}` }
					],
					temperature: 0.7
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw { status: response.status, message: `OpenAI API Error: ${errText}` };
			}

			const data = await response.json() as any;
			return data.choices[0].message.content.trim();
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

	async analyzeIssue(issueTitle: string, issueDesc: string, filePaths: string[]): Promise<AIResponse> {
		return executeWithFallback('Gemini', this.models, async (model) => {
			const prompt = `Anda adalah asisten triase kode ahli. Tugas Anda adalah menganalisis deskripsi issue GitHub dan mencocokkannya dengan daftar berkas relatif workspace proyek untuk menemukan lokasi bug.

GitHub Issue:
Title: ${issueTitle}
Description: ${issueDesc}

Daftar Berkas Workspace:
${JSON.stringify(filePaths, null, 2)}

Kembalikan jawaban secara eksklusif dalam format JSON objek terstruktur dengan skema berikut:
{
  "files": [
    {
      "filePath": "relative/path/to/file.ts",
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "reason": "Alasan singkat mengapa berkas ini relevan dengan issue tersebut"
    }
  ],
  "summary": "Analisis ringkas masalah dalam 1-2 kalimat"
}`;

			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: {
						responseMimeType: "application/json",
						temperature: 0.2
					}
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw { status: response.status, message: `Gemini API Error: ${errText}` };
			}

			const data = await response.json() as any;
			const content = data.candidates[0].content.parts[0].text;
			return parseAIResponse(content);
		});
	}

	async generateReply(issueDesc: string, currentCodeContext: string): Promise<string> {
		return executeWithFallback('Gemini', this.models, async (model) => {
			const prompt = `Tulis draf balasan teknis yang sopan untuk issue GitHub berikut berdasarkan konteks kode proyek saat ini.\n\nGitHub Issue:\n${issueDesc}\n\nKonteks Kode Aktif:\n${currentCodeContext}`;
			
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: {
						temperature: 0.7
					}
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw { status: response.status, message: `Gemini API Error: ${errText}` };
			}

			const data = await response.json() as any;
			return data.candidates[0].content.parts[0].text.trim();
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

	async analyzeIssue(issueTitle: string, issueDesc: string, filePaths: string[]): Promise<AIResponse> {
		return executeWithFallback('Groq', this.models, async (model) => {
			const prompt = `Anda adalah asisten triase kode ahli. Tugas Anda adalah menganalisis deskripsi issue GitHub dan mencocokkannya dengan daftar berkas relatif workspace proyek untuk menemukan lokasi bug.

GitHub Issue:
Title: ${issueTitle}
Description: ${issueDesc}

Daftar Berkas Workspace:
${JSON.stringify(filePaths, null, 2)}

Kembalikan jawaban secara eksklusif dalam format JSON objek terstruktur dengan skema berikut:
{
  "files": [
    {
      "filePath": "relative/path/to/file.ts",
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "reason": "Alasan singkat mengapa berkas ini relevan dengan issue tersebut"
    }
  ],
  "summary": "Analisis ringkas masalah dalam 1-2 kalimat"
}`;

			const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.apiKey}`
				},
				body: JSON.stringify({
					model: model,
					messages: [
						{ role: 'system', content: 'You are an expert developer assistant.' },
						{ role: 'user', content: prompt }
					],
					response_format: { type: "json_object" },
					temperature: 0.2
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw { status: response.status, message: `Groq API Error: ${errText}` };
			}

			const data = await response.json() as any;
			const content = data.choices[0].message.content;
			return parseAIResponse(content);
		});
	}

	async generateReply(issueDesc: string, currentCodeContext: string): Promise<string> {
		return executeWithFallback('Groq', this.models, async (model) => {
			const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.apiKey}`
				},
				body: JSON.stringify({
					model: model,
					messages: [
						{ role: 'system', content: 'You are an expert developer assistant writing a friendly and technical GitHub reply.' },
						{ role: 'user', content: `Tulis draf balasan teknis yang sopan untuk issue GitHub berikut berdasarkan konteks kode proyek saat ini.\n\nGitHub Issue:\n${issueDesc}\n\nKonteks Kode Aktif:\n${currentCodeContext}` }
					],
					temperature: 0.7
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				throw { status: response.status, message: `Groq API Error: ${errText}` };
			}

			const data = await response.json() as any;
			return data.choices[0].message.content.trim();
		});
	}
}

/**
 * 4. Ollama Provider Adapter (Koneksi Lokal)
 */
export class OllamaProvider implements IAIProvider {
	constructor(private hostUrl: string = 'http://localhost:11434', private model: string = 'llama3') {}

	async analyzeIssue(issueTitle: string, issueDesc: string, filePaths: string[]): Promise<AIResponse> {
		const prompt = `Anda adalah asisten triase kode ahli. Tugas Anda adalah menganalisis deskripsi issue GitHub dan mencocokkannya dengan daftar berkas relatif workspace proyek untuk menemukan lokasi bug.

GitHub Issue:
Title: ${issueTitle}
Description: ${issueDesc}

Daftar Berkas Workspace:
${JSON.stringify(filePaths, null, 2)}

Kembalikan jawaban secara eksklusif dalam format JSON objek terstruktur dengan skema berikut:
{
  "files": [
    {
      "filePath": "relative/path/to/file.ts",
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "reason": "Alasan singkat berkas ini relevan"
    }
  ],
  "summary": "Analisis ringkas masalah dalam 1-2 kalimat"
}`;

		const response = await fetch(`${this.hostUrl}/api/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: this.model,
				messages: [{ role: 'user', content: prompt }],
				format: 'json',
				stream: false
			})
		});

		if (!response.ok) {
			const errText = await response.text();
			throw { status: response.status, message: `Ollama Error: ${errText}` };
		}

		const data = await response.json() as any;
		const content = data.message.content;
		return parseAIResponse(content);
	}

	async generateReply(issueDesc: string, currentCodeContext: string): Promise<string> {
		const response = await fetch(`${this.hostUrl}/api/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: this.model,
				messages: [{ 
					role: 'user', 
					content: `Tulis draf balasan teknis yang sopan untuk issue GitHub berikut berdasarkan konteks kode proyek saat ini.\n\nGitHub Issue:\n${issueDesc}\n\nKonteks Kode Aktif:\n${currentCodeContext}` 
				}],
				stream: false
			})
		});

		if (!response.ok) {
			const errText = await response.text();
			throw { status: response.status, message: `Ollama Error: ${errText}` };
		}

		const data = await response.json() as any;
		return data.message.content.trim();
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
