import { App, PluginSettingTab, Setting, SettingDefinitionItem } from 'obsidian';
import type TagRelationPlugin from './main';
import { normalizeIgnoredTags, type SortBy } from './relations';

export interface TagRelationSettings {
	/** Show the folder path of each related note. */
	showPath: boolean;
	/** Show a brief info (first paragraph) of each related note. */
	showSummary: boolean;
	/** Maximum length of the brief info in characters. */
	summaryLength: number;
	/** Sort order of the notes inside each group. */
	sortBy: SortBy;
	/** Render tag pills with rainbow colors (stable per tag name). */
	rainbowTags: boolean;
	/**
	 * Tags excluded from the relation statistics, stored without the `#`
	 * prefix and lower-cased. An ignored tag is treated as if it did not
	 * exist: it never contributes to a shared-tag match or a group key.
	 */
	ignoredTags: string[];
	/**
	 * Internal marker: the panel has been opened automatically once. Not a
	 * user-facing setting; afterwards the layout belongs to the user.
	 */
	autoOpened: boolean;
}

export const DEFAULT_SETTINGS: TagRelationSettings = {
	showPath: true,
	showSummary: true,
	summaryLength: 80,
	sortBy: 'name',
	rainbowTags: false,
	ignoredTags: [],
	autoOpened: false,
};

/** Dropdown labels for the sort order, shared by both settings APIs. */
const SORT_OPTIONS: Record<SortBy, string> = {
	name: '文件名称',
	ctime: '创建时间（新的在前）',
	mtime: '修改时间（新的在前）',
};

/** The ignore list is a multi-line field long enough to need its own text. */
const IGNORED_TAGS_DESC =
	'每行一个标签，带不带 # 均可。被忽略的标签不参与关联统计：' +
	'既不作为共享标签，也不参与分组，等同于该标签不存在。' +
	'支持层级前缀，例如 private 会同时忽略 private/secret。';

/** Narrow an unknown dropdown value back to a known sort order. */
function toSortBy(value: unknown): SortBy {
	return value === 'ctime' || value === 'mtime' ? value : 'name';
}

/**
 * Settings tab with two front ends over the same settings object:
 *
 * - `getSettingDefinitions()` — declarative API, Obsidian 1.13.0 and later.
 *   It is what puts the settings into the global settings search.
 * - `display()` — imperative API, the fallback for versions before 1.13.0
 *   (1.13.0+ skips it once `getSettingDefinitions()` returns a non-empty
 *   array). Keep the two lists in sync when a setting is added or removed.
 */
export class TagRelationSettingTab extends PluginSettingTab {
	plugin: TagRelationPlugin;

	/** Debounces panel refreshes while the user is still typing tags. */
	private refreshTimer: number | null = null;

	constructor(app: App, plugin: TagRelationPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		this.clearRefreshTimer();
		super.hide();
	}

	private clearRefreshTimer(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
	}

	/** A full relation recompute scans the whole vault, so throttle it. */
	private scheduleRefresh(): void {
		this.clearRefreshTimer();
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.plugin.refreshViews();
		}, 300);
	}

	// ---------------------------------------------------------------- declarative

	/**
	 * Declarative definitions (Obsidian 1.13.0+). Values live in
	 * `plugin.settings` and are read/written through `getControlValue` /
	 * `setControlValue` below, which is also where the side effects live.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: '显示路径',
				desc: '在关联文档旁显示其所在文件夹路径。',
				control: { type: 'toggle', key: 'showPath' },
			},
			{
				name: '显示简要信息',
				desc: '在关联文档下方显示文档首段内容。',
				control: { type: 'toggle', key: 'showSummary' },
			},
			{
				name: '简要信息长度',
				desc: '简要信息最多显示的字符数。',
				control: { type: 'slider', key: 'summaryLength', min: 20, max: 300, step: 10 },
			},
			{
				name: '组内排序',
				desc: '关联文档在分组内的排序方式。',
				control: { type: 'dropdown', key: 'sortBy', options: SORT_OPTIONS },
			},
			{
				name: '标签使用彩虹颜色',
				desc: '基于标签名生成稳定的彩虹色，不同标签显示不同颜色。只影响本插件面板内的标签。',
				control: { type: 'toggle', key: 'rainbowTags' },
			},
			// Multi-line text has no control binding that can normalize the
			// value (a string in the UI, an array on disk), so it stays imperative.
			{
				name: '忽略标签',
				desc: IGNORED_TAGS_DESC,
				render: (setting) => this.addIgnoredTagsArea(setting),
			},
		];
	}

	getControlValue(key: string): unknown {
		const settings = this.plugin.settings;
		switch (key) {
			case 'showPath':
				return settings.showPath;
			case 'showSummary':
				return settings.showSummary;
			case 'summaryLength':
				return settings.summaryLength;
			case 'sortBy':
				return settings.sortBy;
			case 'rainbowTags':
				return settings.rainbowTags;
			default:
				return undefined;
		}
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;
		switch (key) {
			case 'showPath':
				settings.showPath = Boolean(value);
				break;
			case 'showSummary':
				settings.showSummary = Boolean(value);
				break;
			case 'summaryLength':
				settings.summaryLength = typeof value === 'number' ? value : settings.summaryLength;
				break;
			case 'sortBy':
				settings.sortBy = toSortBy(value);
				break;
			case 'rainbowTags':
				settings.rainbowTags = Boolean(value);
				break;
			default:
				return;
		}
		// Overriding setControlValue also replaces the automatic save.
		await this.plugin.saveSettings();
		this.afterSettingChanged(key);
	}

	/** Panel side effects of a settings change, for both settings APIs. */
	private afterSettingChanged(key: string): void {
		if (key === 'sortBy') {
			// A new default supersedes any temporary sort picked in the panel.
			this.plugin.clearTemporarySort();
		}
		if (key === 'ignoredTags') {
			// Avoid re-scanning the vault on every keystroke.
			this.scheduleRefresh();
			return;
		}
		this.plugin.refreshViews();
	}

	// ------------------------------------------------------------------ imperative

	/** Imperative fallback for Obsidian versions older than 1.13.0. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('显示路径')
			.setDesc('在关联文档旁显示其所在文件夹路径。')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showPath).onChange(async (value) => {
					this.plugin.settings.showPath = value;
					await this.plugin.saveSettings();
					this.afterSettingChanged('showPath');
				}),
			);

		new Setting(containerEl)
			.setName('显示简要信息')
			.setDesc('在关联文档下方显示文档首段内容。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showSummary)
					.onChange(async (value) => {
						this.plugin.settings.showSummary = value;
						await this.plugin.saveSettings();
						this.afterSettingChanged('showSummary');
					}),
			);

		new Setting(containerEl)
			.setName('简要信息长度')
			.setDesc('简要信息最多显示的字符数。')
			.addSlider((slider) =>
				slider
					.setLimits(20, 300, 10)
					.setValue(this.plugin.settings.summaryLength)
					.onChange(async (value) => {
						this.plugin.settings.summaryLength = value;
						await this.plugin.saveSettings();
						this.afterSettingChanged('summaryLength');
					}),
			);

		new Setting(containerEl)
			.setName('组内排序')
			.setDesc('关联文档在分组内的排序方式。')
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(SORT_OPTIONS)) {
					dropdown.addOption(value, label);
				}
				dropdown.setValue(this.plugin.settings.sortBy).onChange(async (value) => {
					this.plugin.settings.sortBy = toSortBy(value);
					await this.plugin.saveSettings();
					this.afterSettingChanged('sortBy');
				});
			});

		new Setting(containerEl)
			.setName('标签使用彩虹颜色')
			.setDesc('基于标签名生成稳定的彩虹色，不同标签显示不同颜色。只影响本插件面板内的标签。')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.rainbowTags).onChange(async (value) => {
					this.plugin.settings.rainbowTags = value;
					await this.plugin.saveSettings();
					this.afterSettingChanged('rainbowTags');
				}),
			);

		this.addIgnoredTagsArea(new Setting(containerEl).setName('忽略标签').setDesc(IGNORED_TAGS_DESC));
	}

	/** The ignore-list field, shared by both settings APIs. */
	private addIgnoredTagsArea(setting: Setting): void {
		setting.addTextArea((area) => {
			area.inputEl.rows = 5;
			area
				.setPlaceholder('例如 private、#todo、草稿/待办')
				.setValue(this.plugin.settings.ignoredTags.join('\n'))
				.onChange(async (value) => {
					this.plugin.settings.ignoredTags = normalizeIgnoredTags(value);
					await this.plugin.saveSettings();
					// Avoid re-scanning the vault on every keystroke.
					this.afterSettingChanged('ignoredTags');
				});
		});
	}
}
