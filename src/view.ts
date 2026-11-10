import {
	App,
	HoverParent,
	HoverPopover,
	ItemView,
	Menu,
	Notice,
	TAbstractFile,
	TFile,
	WorkspaceLeaf,
	setIcon,
} from 'obsidian';
import type TagRelationPlugin from './main';
import { collectNoteTagState, computeRelationGroups, RelationGroup, SortBy } from './relations';
import { getFileSummary } from './summary';

export const VIEW_TYPE_TAG_RELATION = 'tag-relation-view';

/** `app.setting` is missing from the public typings; this is its minimal shape. */
interface SettingManager {
	open(): void;
	openTabById(id: string): void;
}

/** Human-readable names for the sort modes, shared by the menu and the tooltip. */
const SORT_LABELS: Record<SortBy, string> = {
	name: '文件名称',
	ctime: '创建时间（新的在前）',
	mtime: '修改时间（新的在前）',
};

/** Compact names for the title-bar pill, where the full label is too long. */
const SHORT_SORT_LABELS: Record<SortBy, string> = {
	name: '文件名称',
	ctime: '创建时间',
	mtime: '修改时间',
};

/** Fixed rainbow palette: red → orange → yellow → green → cyan → blue → violet. */
const RAINBOW_COLORS: [string, string][] = [
	['#f5424b', '#ffffff'], // red
	['#f08c35', '#ffffff'], // orange
	['#f2c244', '#402b00'], // yellow
	['#4caf50', '#ffffff'], // green
	['#23b5c9', '#ffffff'], // cyan
	['#3f72e0', '#ffffff'], // blue
	['#9b59d0', '#ffffff'], // violet
];

/** FNV-1a hash so each tag name maps to a stable color across renders. */
function hashString(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** Pick a stable rainbow color for a tag name. */
function rainbowColor(tag: string): { bg: string; color: string } {
	const [bg, color] = RAINBOW_COLORS[hashString(tag) % RAINBOW_COLORS.length]!;
	return { bg, color };
}

export class TagRelationView extends ItemView implements HoverParent {
	hoverPopover: HoverPopover | null = null;

	private currentFile: TFile | null = null;
	private refreshTimer: number | null = null;
	private summaryCache = new Map<string, { mtime: number; length: number; text: string }>();
	private collapsedGroups = new Set<string>();
	private listEl!: HTMLElement;
	private sortBtnEl!: HTMLElement;
	private sortLabelEl!: HTMLElement;
	/**
	 * Panel-local sort chosen from the title bar. It is deliberately kept in
	 * memory only: switching the sort to glance at modified times must not
	 * rewrite the default picked in settings. `null` means "follow the default".
	 */
	private temporarySortBy: SortBy | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: TagRelationPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_TAG_RELATION;
	}

	getDisplayText(): string {
		return '标签关系';
	}

	getIcon(): string {
		return 'tags';
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass('tag-relation-view');
		const titleEl = this.contentEl.createDiv('tag-relation-title');
		const headingEl = titleEl.createDiv('tag-relation-title-heading');
		setIcon(headingEl.createSpan('tag-relation-title-icon'), 'tags');
		headingEl.createSpan({ text: '关联标签文档' });
		const sortBtn = titleEl.createDiv('tag-relation-sort-button');
		setIcon(sortBtn, 'arrow-up-narrow-wide');
		this.sortLabelEl = sortBtn.createSpan('tag-relation-sort-label');
		this.sortBtnEl = sortBtn;
		sortBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			this.showSortMenu(event);
		});
		this.listEl = this.contentEl.createDiv('tag-relation-content');

		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				// Only follow the genuinely active document. Hover previews load a
				// file into a popover without changing the active file, which would
				// otherwise re-target the panel and cause it to jump around.
				if (file && file !== this.app.workspace.getActiveFile()) return;
				this.currentFile = file;
				this.scheduleRefresh();
			}),
		);
		// Recompute when any note's tags change.
		this.registerEvent(this.app.metadataCache.on('changed', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()));
		// Adding or removing a note changes the list itself, not just the
		// contents of a row. Without these two the panel keeps showing a note
		// the reader just deleted, and a freshly created note with shared tags
		// stays invisible until they happen to switch documents.
		this.registerEvent(
			this.app.vault.on('create', (file) => this.onNoteAddedOrRemoved(file)),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				// The note the panel is anchored on is gone: stop following it,
				// otherwise the panel would render relations for a dead file.
				if (this.currentFile && file.path === this.currentFile.path) {
					this.currentFile = null;
				}
				this.onNoteAddedOrRemoved(file);
			}),
		);

		this.currentFile = this.app.workspace.getActiveFile();
		this.refreshNow();
	}

	async onClose() {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.hoverPopover = null;
		this.summaryCache.clear();
		this.containerEl.empty();
	}

	/** Re-render immediately. Public so the plugin can call it after settings change. */
	refreshNow(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.render();
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.render();
		}, 200);
	}

	/**
	 * Refresh after a note appears or disappears. Attachments and folders do
	 * not take part in the relation list, so they cost no re-render.
	 */
	private onNoteAddedOrRemoved(file: TAbstractFile): void {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		this.scheduleRefresh();
	}

	/** The sort actually used for rendering: panel-local override, else the default. */
	private get activeSortBy(): SortBy {
		return this.temporarySortBy ?? this.plugin.settings.sortBy;
	}

	/**
	 * Sort menu on the panel title. Picking an entry only affects this panel
	 * and is not persisted; persisting is a separate, explicit entry.
	 */
	private showSortMenu(event: MouseEvent): void {
		const menu = new Menu();
		const active = this.activeSortBy;
		for (const id of ['name', 'ctime', 'mtime'] as SortBy[]) {
			menu.addItem((item) =>
				item
					.setTitle(SORT_LABELS[id])
					.setChecked(active === id)
					.onClick(() => this.setTemporarySort(id)),
			);
		}

		if (this.temporarySortBy !== null) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(`设为默认排序（${SORT_LABELS[active]}）`)
					.onClick(() => void this.makeSortDefault()),
			);
			menu.addItem((item) =>
				item
					.setTitle(`恢复默认排序（${SORT_LABELS[this.plugin.settings.sortBy]}）`)
					.onClick(() => this.clearTemporarySort()),
			);
		}
		menu.showAtMouseEvent(event);
	}

	/** Apply a panel-local sort. Re-picking the default simply drops the override. */
	private setTemporarySort(sortBy: SortBy): void {
		if (sortBy === this.plugin.settings.sortBy) {
			this.clearTemporarySort();
			return;
		}
		this.temporarySortBy = sortBy;
		this.render();
	}

	/** Drop the panel-local sort so the panel follows the default again. */
	clearTemporarySort(): void {
		if (this.temporarySortBy === null) return;
		this.temporarySortBy = null;
		this.render();
	}

	/** Persist the panel-local sort as the new default, then follow it. */
	private async makeSortDefault(): Promise<void> {
		const sortBy = this.temporarySortBy;
		if (sortBy === null) return;
		this.temporarySortBy = null;
		this.plugin.settings.sortBy = sortBy;
		this.render();
		await this.plugin.saveSettings();
		new Notice(`已将「${SORT_LABELS[sortBy]}」设为默认排序`);
	}

	/** Keep the title-bar button in sync with the sort actually in use. */
	private updateSortButton(): void {
		if (!this.sortBtnEl) return;
		const isTemporary = this.temporarySortBy !== null;
		const label = isTemporary
			? `临时排序：${SORT_LABELS[this.activeSortBy]}（仅本面板，重启恢复默认）`
			: `排序：${SORT_LABELS[this.activeSortBy]}`;
		this.sortBtnEl.setAttribute('aria-label', label);
		this.sortBtnEl.toggleClass('is-temporary', isTemporary);
		if (this.sortLabelEl) {
			this.sortLabelEl.setText(SHORT_SORT_LABELS[this.activeSortBy]);
		}
	}

	private render(): void {
		this.listEl.empty();
		this.updateSortButton();
		const file = this.currentFile;

		if (!file) {
			const empty = this.listEl.createDiv('tag-relation-empty');
			setIcon(empty.createDiv('tag-relation-empty-icon'), 'tags');
			empty.createDiv('tag-relation-empty-title', (el) =>
				el.setText('当前没有打开的笔记'),
			);
			return;
		}

		const groups = computeRelationGroups(
			this.app,
			file,
			this.activeSortBy,
			this.plugin.settings.ignoredTags,
		);
		if (groups.length === 0) {
			this.renderEmpty(file);
			return;
		}

		for (const group of groups) {
			this.renderGroup(group);
		}
	}

	/**
	 * Nothing to show: say *why*. Three different reasons need three
	 * different actions from the reader, so a single generic line hides the
	 * one piece of information they actually need.
	 */
	private renderEmpty(file: TFile): void {
		const state = collectNoteTagState(
			this.app.metadataCache.getFileCache(file),
			this.plugin.settings.ignoredTags,
		);
		const empty = this.listEl.createDiv('tag-relation-empty');
		setIcon(empty.createDiv('tag-relation-empty-icon'), 'tags');

		if (state.total.length === 0) {
			empty.createDiv('tag-relation-empty-title', (el) =>
				el.setText('当前笔记没有标签'),
			);
			empty.createDiv('tag-relation-empty-hint', (el) =>
				el.setText('在正文或属性中添加 #标签 后，这里会列出共享标签的文档'),
			);
			return;
		}

		if (state.active.length === 0) {
			empty.createDiv('tag-relation-empty-title', (el) =>
				el.setText(`当前笔记的 ${state.total.length} 个标签已被全部忽略`),
			);
			const setting = (this.app as App & { setting?: SettingManager }).setting;
			if (!setting) {
				empty.createDiv('tag-relation-empty-hint', (el) =>
					el.setText('请到设置中检查「忽略标签」'),
				);
				return;
			}
			const action = empty.createEl('button', {
				cls: 'tag-relation-empty-action',
				text: '打开忽略标签设置',
			});
			action.addEventListener('click', () => {
				setting.open();
				setting.openTabById(this.plugin.manifest.id);
			});
			return;
		}

		empty.createDiv('tag-relation-empty-title', (el) =>
			el.setText(`当前笔记的 ${state.active.length} 个标签未与其他文档共享`),
		);
	}

	private renderGroup(group: RelationGroup): void {
		const groupEl = this.listEl.createDiv('tag-relation-group');
		const key = group.sharedTags.join('\u0000');
		const collapsed = this.collapsedGroups.has(key);

		const header = groupEl.createDiv('tag-relation-group-header');
		const toggleEl = header.createDiv('tag-relation-group-toggle');
		setIcon(toggleEl, collapsed ? 'chevron-right' : 'chevron-down');

		header.createSpan('tag-relation-group-label', (el) => el.setText('标签列表'));

		const tagsEl = header.createDiv('tag-relation-group-tags');
		for (const tag of group.sharedTags) {
			this.renderTag(tagsEl, tag);
		}

		header.createSpan('tag-relation-group-count', (el) =>
			el.setText(`${group.files.length} 篇`),
		);

		const listEl = groupEl.createDiv('tag-relation-group-files');
		if (collapsed) listEl.addClass('is-collapsed');
		for (const file of group.files) {
			this.renderFileRow(listEl, file);
		}

		// Click anywhere on the header (except tags) toggles the group.
		header.addEventListener('click', () => {
			if (this.collapsedGroups.has(key)) {
				this.collapsedGroups.delete(key);
			} else {
				this.collapsedGroups.add(key);
			}
			this.render();
		});
	}

	private renderTag(parent: HTMLElement, tag: string): void {
		const tagEl = parent.createSpan({
			cls: 'tag tag-relation-tag',
			text: `#${tag}`,
		});
		if (this.plugin.settings.rainbowTags) {
			const { bg, color } = rainbowColor(tag);
			tagEl.addClass('tag-relation-tag-rainbow');
			tagEl.style.setProperty('--rainbow-bg', bg);
			tagEl.style.setProperty('--rainbow-color', color);
		}
		tagEl.addEventListener('click', (event) => {
			event.stopPropagation();
			this.openTagSearch(tag);
		});
	}

	/** Open Obsidian's built-in search for the tag. */
	private openTagSearch(tag: string): void {
		const searchPlugin = (this.app as App & { internalPlugins?: unknown })
			.internalPlugins as { plugins?: Record<string, { instance?: { openGlobalSearch(query: string): void } }> } | undefined;
		const instance = searchPlugin?.plugins?.['global-search']?.instance;
		if (!instance) {
			new Notice(
				'无法打开标签搜索：请先启用「全局搜索」核心插件（设置 → 核心插件）',
			);
			return;
		}
		instance.openGlobalSearch(`tag:${tag}`);
	}

	private renderFileRow(parent: HTMLElement, file: TFile): void {
		const row = parent.createDiv('tag-relation-file');

		const linkEl = row.createEl('a', {
			cls: 'tag-relation-file-link internal-link',
			text: file.basename,
		});
		linkEl.addEventListener('click', (event) => {
			event.preventDefault();
			const newLeaf = event.ctrlKey || event.metaKey;
			void this.app.workspace.getLeaf(newLeaf).openFile(file);
		});
		// Middle-click (mouse wheel button) opens in a new tab and activates it,
		// so the panel follows the new document just like Ctrl+click.
		linkEl.addEventListener('auxclick', (event) => {
			if (event.button !== 1) return;
			event.preventDefault();
			void this.app.workspace.getLeaf(true).openFile(file);
		});
		// Native page preview hover (requires "Page preview" core plugin).
		linkEl.addEventListener('mouseover', (event) => {
			this.app.workspace.trigger('hover-link', {
				event,
				source: VIEW_TYPE_TAG_RELATION,
				hoverParent: this,
				targetEl: linkEl,
				linktext: file.path,
			});
		});

		if (this.plugin.settings.showPath) {
			row.createDiv('tag-relation-file-path', (el) =>
				el.setText(file.parent ? file.parent.path : '/'),
			);
		}

		if (this.plugin.settings.showSummary) {
			const summaryEl = row.createDiv('tag-relation-file-summary');
			void this.loadSummary(file).then((text) => {
				if (summaryEl.isConnected) summaryEl.setText(text);
			});
		}
	}

	private async loadSummary(file: TFile): Promise<string> {
		const length = this.plugin.settings.summaryLength;
		const cached = this.summaryCache.get(file.path);
		if (cached && cached.mtime === file.stat.mtime && cached.length === length) {
			return cached.text;
		}
		const text = await getFileSummary(this.app.vault, file, length);
		this.summaryCache.set(file.path, { mtime: file.stat.mtime, length, text });
		// Keep the cache bounded on large vaults.
		if (this.summaryCache.size > 500) {
			const oldest = this.summaryCache.keys().next().value;
			if (typeof oldest === 'string') this.summaryCache.delete(oldest);
		}
		return text;
	}
}
