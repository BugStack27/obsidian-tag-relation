import { App, PluginSettingTab, Setting } from 'obsidian';
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
}

export const DEFAULT_SETTINGS: TagRelationSettings = {
	showPath: true,
	showSummary: true,
	summaryLength: 80,
	sortBy: 'name',
	rainbowTags: false,
	ignoredTags: [],
};

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
					this.plugin.refreshViews();
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
						this.plugin.refreshViews();
					}),
			);

		new Setting(containerEl)
			.setName('简要信息长度')
			.setDesc('简要信息最多显示的字符数。')
			.addSlider((slider) =>
				slider
					.setLimits(20, 300, 10)
					.setValue(this.plugin.settings.summaryLength)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.summaryLength = value;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					}),
			);

		new Setting(containerEl)
			.setName('组内排序')
			.setDesc('关联文档在分组内的排序方式。')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('name', '文件名称')
					.addOption('ctime', '创建时间（新的在前）')
					.addOption('mtime', '修改时间（新的在前）')
					.setValue(this.plugin.settings.sortBy)
					.onChange(async (value) => {
						this.plugin.settings.sortBy = value as SortBy;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					}),
			);

		new Setting(containerEl)
			.setName('标签使用彩虹颜色')
			.setDesc('基于标签名生成稳定的彩虹色，不同标签显示不同颜色。只影响本插件面板内的标签。')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.rainbowTags).onChange(async (value) => {
					this.plugin.settings.rainbowTags = value;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				}),
			);

		new Setting(containerEl)
			.setName('忽略标签')
			.setDesc(
				'每行一个标签，带不带 # 均可。被忽略的标签不参与关联统计：' +
					'既不作为共享标签，也不参与分组，等同于该标签不存在。' +
					'支持层级前缀，例如 private 会同时忽略 private/secret。',
			)
			.addTextArea((area) => {
				area.inputEl.rows = 5;
				area
					.setPlaceholder('例如 private、#todo、草稿/待办')
					.setValue(this.plugin.settings.ignoredTags.join('\n'))
					.onChange(async (value) => {
						this.plugin.settings.ignoredTags = normalizeIgnoredTags(value);
						await this.plugin.saveSettings();
						// Avoid re-scanning the vault on every keystroke.
						this.scheduleRefresh();
					});
			});
	}
}