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

/** A line that carries no prose and is skipped before the summary starts. */
function isDecoration(line: string): boolean {
	return (
		/^#{1,6}\s/.test(line) || // heading
		/^#\S+/.test(line) || // bare tag line
		/^!\[/.test(line) || // image
		/^---+$/.test(line) || // horizontal rule
		/^>/.test(line) // blockquote
	);
}

/** A block-level line that ends the summary paragraph once it has started. */
function startsBlock(line: string): boolean {
	return (
		isDecoration(line) ||
		/^([-*+]|\d+[.)])\s/.test(line) || // list item
		/^\|/.test(line) // table row
	);
}

/** Strip the inline markdown of a single line down to display text. */
function toPlainText(line: string): string {
	return line
		.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g, '$1')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_`~#]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

const CJK_CHAR = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/;

/**
 * Whether a hard-wrapped line break should become a space. CJK text wraps
 * without spaces, so a break between two CJK characters is joined directly.
 */
function joinFragments(fragments: string[]): string {
	return fragments.reduce((text, fragment) => {
		if (!text) return fragment;
		const before = text.slice(-1);
		const after = fragment.slice(0, 1);
		const separator = CJK_CHAR.test(before) && CJK_CHAR.test(after) ? '' : ' ';
		return text + separator + fragment;
	}, '');
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
	const fragments: string[] = [];

	for (; i < lines.length; i++) {
		const line = (lines[i] ?? '').trim();

		if (line.startsWith('```') || line.startsWith('~~~')) {
			inCode = !inCode;
			if (fragments.length) break;
			continue;
		}
		if (inCode) continue;

		// The paragraph ends at the first blank line or block-level element.
		if (!line) {
			if (fragments.length) break;
			continue;
		}
		if (!fragments.length) {
			// Nothing collected yet: skip decoration until real prose starts.
			if (isDecoration(line)) continue;
		} else if (startsBlock(line)) {
			break;
		}

		const text = toPlainText(line);
		if (!text) continue;

		fragments.push(text);
	}

	const paragraph = joinFragments(fragments);
	return paragraph.length > maxLength
		? paragraph.slice(0, maxLength).trimEnd() + '…'
		: paragraph;
}
