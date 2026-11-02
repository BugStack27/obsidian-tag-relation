import { App, CachedMetadata, TFile, getAllTags } from 'obsidian';

/** Sort order for the notes inside each group. */
export type SortBy = 'name' | 'ctime' | 'mtime';

/**
 * A group of notes that share exactly the same set of tags with the
 * current note. Tags are compared case-insensitively, but `sharedTags`
 * keep the spelling used by the current note. Names carry no `#` prefix
 * and are sorted ascending.
 */
export interface RelationGroup {
	/** Shared tag names (no `#`), current note's spelling, sorted ascending. */
	sharedTags: string[];
	/** Related notes in this group, sorted by basename. */
	files: TFile[];
}

/** Extract all tags (body + frontmatter) of a file, normalized with `#` prefix. */
export function extractTags(cache: CachedMetadata | null): Set<string> {
	const tags = new Set<string>();
	if (!cache) return tags;
	for (const tag of getAllTags(cache) ?? []) {
		tags.add(tag);
	}
	return tags;
}

/** Drop the leading `#` characters, keeping the original spelling. */
function displayTagName(tag: string): string {
	return tag.trim().replace(/^#+/, '').trim();
}

/** Canonical tag name used for comparison: no `#`, lower-cased. */
function normalizeTagName(tag: string): string {
	return displayTagName(tag).toLowerCase();
}

/**
 * Map each tag of a file to its canonical name plus the file's own
 * spelling, so relations can match case-insensitively while the panel
 * still shows what the author wrote.
 */
function collectTagNames(cache: CachedMetadata | null): Map<string, string> {
	const names = new Map<string, string>();
	for (const tag of extractTags(cache)) {
		const name = normalizeTagName(tag);
		if (name && !names.has(name)) names.set(name, displayTagName(tag));
	}
	return names;
}

/**
 * Normalize a raw ignore list (multi-line text or an array) into tag names
 * without the `#` prefix, lower-cased and de-duplicated.
 *
 * Blank lines are skipped, so a trailing newline in the settings textarea is
 * harmless. Both `private` and `#private` are accepted and mean the same thing.
 */
export function normalizeIgnoredTags(input: string | string[]): string[] {
	const lines = Array.isArray(input) ? input : input.split(/\r?\n/);
	const result: string[] = [];
	const seen = new Set<string>();
	for (const line of lines) {
		const name = normalizeTagName(line);
		if (!name || seen.has(name)) continue;
		seen.add(name);
		result.push(name);
	}
	return result;
}

/**
 * Whether `tag` (with or without `#`) is covered by the ignore list.
 *
 * Matching is case-insensitive and hierarchy-aware: `private` covers both
 * `private` and `private/secret`, but not `privateX`.
 */
export function isIgnoredTag(tag: string, ignored: string[]): boolean {
	const name = normalizeTagName(tag);
	if (!name) return false;
	return ignored.some((entry) => {
		const prefix = normalizeTagName(entry);
		return prefix !== '' && (name === prefix || name.startsWith(`${prefix}/`));
	});
}

/** A note's tags split by whether the ignore list drops them. */
export interface NoteTagState {
	/** Every tag of the note, `#` prefix included, sorted ascending. */
	total: string[];
	/** Tags that survive the ignore list — the ones used for relations. */
	active: string[];
	/** Tags dropped by the ignore list. */
	ignored: string[];
}

/**
 * Split a note's tags into the ones that still count and the ones the
 * ignore list drops. This is the single place that applies the ignore
 * rules, so the panel's empty-state messages and the relation computation
 * can never disagree about why a tag is missing.
 */
export function collectNoteTagState(
	cache: CachedMetadata | null,
	ignoredTags: string[] = [],
): NoteTagState {
	const ignored = normalizeIgnoredTags(ignoredTags);
	const state: NoteTagState = { total: [], active: [], ignored: [] };
	for (const tag of [...extractTags(cache)].sort()) {
		state.total.push(tag);
		if (isIgnoredTag(tag, ignored)) state.ignored.push(tag);
		else state.active.push(tag);
	}
	return state;
}

/**
 * Compute the related notes of `current`, grouped by the exact set of
 * shared tags. Tag names are compared case-insensitively, so `#TODO` and
 * `#todo` count as the same tag and land in one group; the displayed names
 * keep the current note's spelling. Groups are sorted by shared tag count
 * (descending), then by tag names ascending; notes inside a group are
 * sorted by basename.
 *
 * Only files that share at least one tag with `current` are returned.
 *
 * `ignoredTags` are dropped from the current note's tag set before anything
 * else happens, so an ignored tag behaves as if it did not exist: it can
 * never appear in `sharedTags` and never influences a group key. Filtering
 * `currentTags` alone is sufficient, because the loop below only looks at
 * tags the current note actually carries.
 *
 * Uses only public APIs (`Vault.getMarkdownFiles` + `MetadataCache.getFileCache`)
 * so behavior does not depend on undocumented runtime methods.
 */
export function computeRelationGroups(
	app: App,
	current: TFile,
	sortBy: SortBy = 'name',
	ignoredTags: string[] = [],
): RelationGroup[] {
	// canonical name -> the current note's spelling, used for display.
	const currentTags = new Map<string, string>();
	for (const tag of collectNoteTagState(app.metadataCache.getFileCache(current), ignoredTags).active) {
		const name = normalizeTagName(tag);
		if (name && !currentTags.has(name)) currentTags.set(name, displayTagName(tag));
	}
	if (currentTags.size === 0) return [];

	// path -> { file, shared canonical tag names }
	const related = new Map<string, { file: TFile; shared: Set<string> }>();

	for (const file of app.vault.getMarkdownFiles()) {
		if (file.path === current.path) continue;
		const fileTags = collectTagNames(app.metadataCache.getFileCache(file));
		const shared = new Set<string>();
		for (const name of currentTags.keys()) {
			if (fileTags.has(name)) shared.add(name);
		}
		if (shared.size > 0) {
			related.set(file.path, { file, shared });
		}
	}

	const byKey = new Map<string, RelationGroup>();
	for (const { file, shared } of related.values()) {
		const names = [...shared].sort();
		const key = names.join('\u0000');
		let group = byKey.get(key);
		if (!group) {
			group = {
				sharedTags: names.map((name) => currentTags.get(name) ?? name),
				files: [],
			};
			byKey.set(key, group);
		}
		group.files.push(file);
	}

	const groups = [...byKey.entries()]
		.sort(([keyA, groupA], [keyB, groupB]) => {
			// More shared tags first, then tag names ascending.
			const byCount = groupB.sharedTags.length - groupA.sharedTags.length;
			if (byCount !== 0) return byCount;
			return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
		})
		.map(([, group]) => group);

	for (const group of groups) {
		group.files.sort((a, b) => compareFiles(a, b, sortBy));
	}

	return groups;
}

/** Name: ascending; time: most recent first. */
function compareFiles(a: TFile, b: TFile, sortBy: SortBy): number {
	if (sortBy === 'ctime') return b.stat.ctime - a.stat.ctime;
	if (sortBy === 'mtime') return b.stat.mtime - a.stat.mtime;
	return a.basename.localeCompare(b.basename);
}
