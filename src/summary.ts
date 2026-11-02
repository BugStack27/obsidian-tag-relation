import { TFile, Vault } from 'obsidian';

/** Read the first meaningful paragraph of a note, for display as a brief info. */
export async function getFileSummary(
	vault: Vault,
	file: TFile,
	maxLength: number,
): Promise<string> {
	try {
		const content = await vault.cachedRead(file);
		return extractSummary(content, maxLength);
	} catch {
		return '';
	}
}

/** Extract a brief plain-text summary from markdown content. */
export function extractSummary(content: string, maxLength: number): string {
	const lines = content.split(/\r?\n/);

	// Skip YAML frontmatter.
	let i = 0;
	if (lines[0]?.trim() === '---') {
		i = 1;
		while (i < lines.length && lines[i]?.trim() !== '---') i++;
		i++; // skip the closing `---`
	}

	let inCode = false;
	for (; i < lines.length; i++) {
		const line = (lines[i] ?? '').trim();
		if (!line) continue;

		if (line.startsWith('```') || line.startsWith('~~~')) {
			inCode = !inCode;
			continue;
		}
		if (inCode) continue;

		// Skip headings, bare tag lines, images, horizontal rules, blockquotes.
		if (/^#{1,6}\s/.test(line)) continue;
		if (/^#\S+/.test(line)) continue;
		if (/^!\[/.test(line)) continue;
		if (/^---+$/.test(line)) continue;
		if (/^>/.test(line)) continue;

		const text = line
			.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g, '$1')
			.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/[*_`~#]/g, '')
			.replace(/\s+/g, ' ')
			.trim();
		if (!text) continue;

		return text.length > maxLength
			? text.slice(0, maxLength).trimEnd() + '…'
			: text;
	}

	return '';
}
