import * as assert from 'assert';
import { parseAIResponse } from '../ai/AIClient';

suite('AIClient Response Parsing Test Suite', () => {

	test('parseAIResponse should parse clean JSON', () => {
		const jsonString = JSON.stringify({
			files: [
				{
					filePath: 'src/index.ts',
					confidence: 'HIGH',
					reason: 'Main entry point',
					lineRange: { start: 1, end: 10 },
					targetSymbol: 'main'
				}
			],
			summary: 'Clean JSON test'
		});

		const result = parseAIResponse(jsonString);
		assert.strictEqual(result.summary, 'Clean JSON test');
		assert.strictEqual(result.files.length, 1);
		assert.strictEqual(result.files[0].filePath, 'src/index.ts');
		assert.strictEqual(result.files[0].confidence, 'HIGH');
		assert.deepStrictEqual(result.files[0].lineRange, { start: 1, end: 10 });
		assert.strictEqual(result.files[0].targetSymbol, 'main');
	});

	test('parseAIResponse should parse JSON wrapped in markdown code blocks', () => {
		const mdString = `
\`\`\`json
{
  "files": [
    {
      "filePath": "src/utils.ts",
      "confidence": "low",
      "reason": "Utility functions"
    }
  ],
  "summary": "Markdown wrapped test"
}
\`\`\`
`;

		const result = parseAIResponse(mdString);
		assert.strictEqual(result.summary, 'Markdown wrapped test');
		assert.strictEqual(result.files.length, 1);
		assert.strictEqual(result.files[0].filePath, 'src/utils.ts');
		assert.strictEqual(result.files[0].confidence, 'LOW'); // normalized to UPPERCASE
		assert.strictEqual(result.files[0].lineRange, undefined);
	});

	test('parseAIResponse should extract JSON from conversational text', () => {
		const convoString = `
Sure, here is the analysis:
{
  "files": [
    {
      "filePath": "src/App.tsx",
      "confidence": "MEDIUM",
      "reason": "App UI component"
    }
  ],
  "summary": "Conversational test"
}
Hope this helps!
`;

		const result = parseAIResponse(convoString);
		assert.strictEqual(result.summary, 'Conversational test');
		assert.strictEqual(result.files.length, 1);
		assert.strictEqual(result.files[0].filePath, 'src/App.tsx');
		assert.strictEqual(result.files[0].confidence, 'MEDIUM');
	});

	test('parseAIResponse should throw error for invalid JSON', () => {
		const invalidString = 'Not a JSON at all';
		assert.throws(() => {
			parseAIResponse(invalidString);
		}, /Respons dari AI bukan JSON yang valid/);
	});

	test('parseAIResponse should normalize invalid confidence levels to MEDIUM', () => {
		const jsonString = JSON.stringify({
			files: [
				{
					filePath: 'src/index.ts',
					confidence: 'VERY_HIGH', // invalid
					reason: 'Main entry point'
				}
			],
			summary: 'Confidence normalization'
		});

		const result = parseAIResponse(jsonString);
		assert.strictEqual(result.files.length, 1);
		assert.strictEqual(result.files[0].confidence, 'MEDIUM');
	});

	test('parseAIResponse should validate and filter invalid line ranges', () => {
		const jsonString = JSON.stringify({
			files: [
				{
					filePath: 'src/index.ts',
					confidence: 'HIGH',
					reason: 'Main entry point',
					lineRange: { start: 10, end: 5 } // invalid: end < start
				},
				{
					filePath: 'src/utils.ts',
					confidence: 'HIGH',
					reason: 'Utilities',
					lineRange: { start: -1, end: 10 } // invalid: start <= 0
				}
			],
			summary: 'Line range validation'
		});

		const result = parseAIResponse(jsonString);
		assert.strictEqual(result.files.length, 2);
		assert.strictEqual(result.files[0].lineRange, undefined);
		assert.strictEqual(result.files[1].lineRange, undefined);
	});
});
