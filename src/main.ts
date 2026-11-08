import { Plugin } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	TagRelationSettings,
	TagRelationSettingTab,
} from './settings';
import { TagRelationView, VIEW_TYPE_TAG_RELATION } from './view';

export default class TagRelationPlugin extends Plugin {
	settings!: TagRelationSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_TAG_RELATION, (leaf) => new TagRelationView(leaf, this));

		// Let the "Page preview" core plugin control hover for our view.
		this.registerHoverLinkSource(VIEW_TYPE_TAG_RELATION, {
			display: '标签关系',
			defaultMod: false,
		});

		this.addRibbonIcon('tags', '打开标签关系面板', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-panel',
			name: '打开标签关系面板',
			callback: () => {
				void this.activateView();
			},
		});

		this.addSettingTab(new TagRelationSettingTab(this.app, this));

		// Open the panel in the right sidebar once the layout is ready.
		this.app.workspace.onLayoutReady(() => {
			void this.activateView();
		});
	}

	onunload() {
		this.app.workspace
			.getLeavesOfType(VIEW_TYPE_TAG_RELATION)
			.forEach((leaf) => leaf.detach());
	}

	/** Reveal the panel, creating it in the right sidebar if needed. */
	async activateView() {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_TAG_RELATION)[0];
		if (existing) {
			await workspace.revealLeaf(existing);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_TAG_RELATION, active: true });
		await workspace.revealLeaf(leaf);
	}

	/** Ask every open panel to re-render (used after settings changes). */
	refreshViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TAG_RELATION)) {
			if (leaf.view instanceof TagRelationView) {
				leaf.view.refreshNow();
			}
		}
	}

	/**
	 * Drop the panel-local sort overrides so the newly chosen default applies
	 * everywhere. Called when the default in settings changes.
	 */
	clearTemporarySort() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TAG_RELATION)) {
			if (leaf.view instanceof TagRelationView) {
				leaf.view.clearTemporarySort();
			}
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<TagRelationSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
