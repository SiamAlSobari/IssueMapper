export interface CodeFixRequest {
	filePath: string;
	fileContent: string;
	issueTitle: string;
	issueDescription: string;
	lineRange?: { start: number; end: number };
	targetSymbol?: string;
	gitBranch?: string;
	projectRules?: string;
}

export interface CodeFixSuggestion {
	filePath: string;
	oldCode: string;
	newCode: string;
	summary: string;
	startLine: number;
	endLine: number;
}

export interface CodeFixResponse {
	fixes: CodeFixSuggestion[];
	explanation: string;
}

export function buildCodeFixPrompt(request: CodeFixRequest): string {
	const { filePath, fileContent, issueTitle, issueDescription, lineRange, targetSymbol, gitBranch, projectRules } = request;

	let contextBlock = '';
	if (lineRange) {
		contextBlock += `\nLokasi yang Diduga Bermasalah: Baris ${lineRange.start}-${lineRange.end}`;
	}
	if (targetSymbol) {
		contextBlock += `\nSimbol Target: ${targetSymbol}`;
	}
	if (gitBranch) {
		contextBlock += `\nCabang Aktif: ${gitBranch}`;
	}

	const projectRulesBlock = projectRules ? `\n\nAturan Proyek:\n${projectRules}` : '';

	return `Anda adalah asisten pemrogram ahli. Tugas Anda adalah menghasilkan perbaikan kode (code patch) untuk issue berikut.

Judul Issue: ${issueTitle}
Deskripsi Issue: ${issueDescription}

Berkas yang Akan Diperbaiki: ${filePath}
${contextBlock}${projectRulesBlock}

Kode Saat Ini:
\`\`\`
${fileContent}
\`\`\`

Instruksi:
1. Analisis issue dan kode di atas secara seksama.
2. Identifikasi bagian kode yang perlu diubah untuk memperbaiki issue.
3. Hasilkan perbaikan kode yang tepat, minimal, dan aman.
4. Jangan mengubah kode yang tidak terkait dengan issue.

Kembalikan jawaban secara eksklusif dalam format JSON objek terstruktur dengan skema berikut:
{
  "fixes": [
    {
      "filePath": "${filePath}",
      "oldCode": "Kode lama yang akan diganti (persis seperti yang ada di berkas, termasuk indentasi)",
      "newCode": "Kode baru hasil perbaikan sebagai pengganti",
      "summary": "Penjelasan singkat tentang perubahan ini",
      "startLine": <nomor baris awal perubahan>,
      "endLine": <nomor baris akhir perubahan>
    }
  ],
  "explanation": "Penjelasan lengkap tentang perbaikan yang dilakukan dan bagaimana ini menyelesaikan issue"
}

Catatan:
- oldCode harus cocok persis dengan kode yang ada di berkas (termasuk spasi/indentasi).
- startLine dan endLine adalah 1-indexed.
- Jika issue memerlukan perubahan di banyak bagian, gunakan multiple entries di array fixes.
- Jangan mengubah format JSON, jangan tambahkan markdown wrapper.`;
}

export function parseCodeFixResponse(text: string): CodeFixResponse {
	let cleanText = text.trim();

	if (cleanText.startsWith('```')) {
		cleanText = cleanText.replace(/^```(?:json)?\s*/i, '');
		cleanText = cleanText.replace(/\s*```$/, '');
	}
	cleanText = cleanText.trim();

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(cleanText) as Record<string, unknown>;
	} catch {
		const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			try {
				parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
			} catch (innerError) {
				throw new Error(`Respons AI perbaikan kode bukan JSON yang valid.`);
			}
		} else {
			throw new Error(`Respons AI perbaikan kode bukan JSON yang valid.`);
		}
	}

	const fixes: CodeFixSuggestion[] = Array.isArray(parsed.fixes) ? parsed.fixes.map((f: Record<string, unknown>) => ({
		filePath: typeof f.filePath === 'string' ? f.filePath : '',
		oldCode: typeof f.oldCode === 'string' ? f.oldCode : '',
		newCode: typeof f.newCode === 'string' ? f.newCode : '',
		summary: typeof f.summary === 'string' ? f.summary : '',
		startLine: typeof f.startLine === 'number' && f.startLine > 0 ? f.startLine : 1,
		endLine: typeof f.endLine === 'number' && f.endLine > 0 ? f.endLine : 1,
	})).filter((f: CodeFixSuggestion) => f.filePath !== '' && (f.oldCode !== '' || f.newCode !== '')) : [];

	return {
		fixes,
		explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
	};
}
