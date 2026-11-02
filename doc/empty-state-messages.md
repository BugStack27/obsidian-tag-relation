---
date: 2026-10-24
description: 关联面板的空结果按「无标签 / 标签全被忽略 / 无共享」三种原因分别提示，并提供打开忽略标签设置的入口
---

# 空结果按三种原因分别提示 - 任务规划

## 1. 需求概述

当前面板在没有任何关联时只显示一句「没有找到共享标签的关联文档」，用户无法区分到底是：

1. 当前笔记**根本没有标签**；
2. 当前笔记有标签，但**全部命中忽略标签**（默认忽略列表已含 `feat`/`fix`/`check`/`pref`，这种情况并不罕见）；
3. 当前笔记有可用标签，但**全库确实没有其它笔记共享**。

三者的处理动作完全不同：第 1 种要用户去加标签，第 2 种要用户去改忽略设置，第 3 种无需操作。因此空态改为按原因分化文案，第 2 种附带直达本插件设置页的入口，第 3 种显示当前笔记参与统计的标签数。

**现状证据（实现前已核对）**

| 位置 | 现状 |
|------|------|
| `src/relations.ts:96` | `currentTags.size === 0` 直接 `return []`，把「无标签」和「全被忽略」压成同一个空结果，原因信息在此丢失 |
| `src/view.ts:167-171` | `groups.length === 0` 时统一输出一句通用文案 |
| `doc/ignore-tags.md` 决策 3 | 历史约定「剔除后标签为空 → 显示通用空态文案」，本需求正是对该约定的细化，需同步在该文档补记 |
| `data.json` | 忽略列表实际已配置 `feat`、`fix`、`check`、`pref`，第 2 种情况在真实 vault 中会出现 |

## 2. 需求澄清记录

| 模糊点 | 澄清结果（用户确认） |
|--------|----------------------|
| 第三种情况是否显示标签数 | **显示「N 个标签参与统计」**，例如「当前笔记的 3 个标签未与其他文档共享」。不显示被忽略标签数，避免把注意力引向无关设置 |
| 「全被忽略」的入口形式 | **可点击文字按钮，直跳本插件设置页**：点击后打开设置窗口并定位到 Tag Relation 的设置页，用户可直接编辑忽略标签输入框 |
| 「无标签」文案是否给添加方式 | **说明 + 加标签方式**：文案含「在正文或属性中添加 `#标签`」 |
| 视觉强度 | **沿用现有朴素灰字**（复用 `.tag-relation-empty`），只分化文案；仅为「全被忽略」那条新增一个可点击入口的样式 |
| 判定基准 | 三态判定只针对**当前笔记**的标签集合，与 `computeRelationGroups` 使用同一套剔除规则（`isIgnoredTag`），不新增第二套匹配逻辑 |
| 「参与统计的标签数」口径 | 剔除忽略标签并去重后的标签个数；被忽略标签按「命中忽略规则的标签」计，**每个标签只计 1 次**（一个标签命中多条忽略项不重复计） |
| 判断顺序 | 先判断「无打开笔记」→「无标签」→「全被忽略」→「无共享」，互斥且必然落入其中一支 |

## 3. 任务列表

### 任务 1：抽出三态可区分的标签统计函数

| 属性 | 值 |
|------|-----|
| **描述** | 在 `src/relations.ts` 新增导出函数 `collectNoteTagState(cache: CachedMetadata \| null, ignoredTags: string[] = []): { total: string[]; active: string[]; ignored: string[] }`：<br>① `total` — `extractTags(cache)` 的原始标签（保持 `#` 前缀，排序后返回，便于稳定输出）；<br>② `active` — `total` 中未被忽略的标签；<br>③ `ignored` — `total` 中命中 `isIgnoredTag` 的标签。<br>随后把 `computeRelationGroups` 里 `currentTags` 的构造改为复用该函数（`new Set(collectNoteTagState(...).active)`），**不改变任何计算行为与对外签名**，确保剔除规则只有一处实现。<br>内部仍先 `normalizeIgnoredTags` 归一一次，不重复归一。 |
| **依赖关系** | 无 |
| **验收标准** | 改动前后对同一假 vault 的 `computeRelationGroups` 输出逐项一致（分组数、分组 key、组内顺序均不变）；`collectNoteTagState` 对「无标签 / 全部被忽略 / 部分被忽略 / 无忽略配置」四种输入分别返回预期的 `total/active/ignored`；`active.length + ignored.length === total.length`；同一标签命中多条忽略项时 `ignored` 只出现一次 |

### 任务 2：空态按三种原因分化文案并提供设置入口

| 属性 | 值 |
|------|-----|
| **描述** | 修改 `src/view.ts` 的 `render()`：<br>① `file === null` 时保持现有「当前没有打开的笔记」不变（不属于本需求的三态）。<br>② `groups.length === 0` 时调用 `collectNoteTagState(app.metadataCache.getFileCache(file), this.plugin.settings.ignoredTags)` 取统计，按顺序判定并渲染：<br>　• `total.length === 0` → 「当前笔记没有标签」+ 副句「在正文或属性中添加 `#标签` 后，这里会列出共享标签的文档」；<br>　• `active.length === 0`（且 `total.length > 0`，此时 `ignored.length > 0`）→ 「当前笔记的 N 个标签已被全部忽略」+ 可点击入口「打开忽略标签设置」；<br>　• 否则 → 「当前笔记的 N 个标签未与其他文档共享」，`N = active.length`。<br>③ 设置入口点击后打开设置窗口并定位到本插件：`this.app.setting?.open()` 后 `openTabById(this.plugin.manifest.id)`。`App` 上未公开 `setting`，沿用本文件既有做法（`openTagSearch` 里的 `internalPlugins`）做最小类型断言 `App & { setting?: { open(): void; openTabById(id: string): void } }`，`strict` 下需通过可选链与判空，断言不到时不报错、只保留文字提示。<br>④ 文案中的数字用真实统计值，不做硬编码；新增的 DOM 结构只多用 `tag-relation-empty-title` / `tag-relation-empty-hint` / `tag-relation-empty-action` 三个 class。 |
| **依赖关系** | 任务 1 |
| **验收标准** | 四个分支（无打开笔记 / 无标签 / 全被忽略 / 无共享）各自只出现对应文案，切换笔记后文案随之变化；「无共享」分支显示的数字等于当前笔记剔除忽略标签后的标签数；「全被忽略」分支的入口可点击且点击后设置窗口打开在 Tag Relation 页；`tsc -noEmit` 无新增类型错误 |

### 任务 3：空态入口的样式

| 属性 | 值 |
|------|-----|
| **描述** | 在 `styles.css` 的 `.tag-relation-empty` 之后补充三条规则：标题与提示的行距/间距（保持灰字、小字号，不引入背景色或边框）、`.tag-relation-empty-hint` 的次要色（`var(--text-faint)`）、`.tag-relation-empty-action` 的可点击样式（`var(--text-accent)` + `cursor: pointer`，hover 加下划线）。仅影响空态内部结构，不改既有分组/文件行样式。 |
| **依赖关系** | 任务 2（沿用其确定的 class 名） |
| **验收标准** | 三种空态的标题、提示、入口在浅色与深色主题下均清晰可读；入口有明显的可点击反馈（hover 下划线）；分组、文件行、标签 pill 的现有样式无任何变化 |

### 任务 4：构建与静态检查

| 属性 | 值 |
|------|-----|
| **描述** | 依次执行 `npx tsc -noEmit -skipLibCheck`、`npm run lint`、`npm run build`，确认无新增错误；构建产物 `main.js` 更新到插件根目录。 |
| **依赖关系** | 任务 1-3 |
| **验收标准** | `tsc` 退出码 0；`eslint` 退出码 0（允许保留既有的 `obsidianmd/settings-tab/prefer-setting-definitions` warning）；`npm run build` 退出码 0 且 `main.js` 的 `LastWriteTime` 晚于本次构建开始时间 |

### 任务 5：同步历史决策文档

| 属性 | 值 |
|------|-----|
| **描述** | 在 `doc/ignore-tags.md` 的「派生设计决策」第 3 条后补一行指向本需求：由「统一通用文案」改为「三态分化文案」，并说明判定口径（`active.length === 0` 走「全被忽略」分支）。只增补说明，不改历史结论。 |
| **依赖关系** | 任务 2（口径以最终实现为准） |
| **验收标准** | `doc/ignore-tags.md` 决策 3 处有一条明确的前向引用，读者不会误以为现行行为仍是通用文案 |

## 4. 执行顺序

```
任务 1 ──→ 任务 2 ──→ 任务 3 ──→ 任务 4
                └──→ 任务 5
```

- 任务 1 必须先做：三态判定依赖 `collectNoteTagState`，且要求剔除规则只保留一处实现。
- 任务 2 是核心，任务 3、任务 5 都以它的产出（class 名、命中口径）为准。
- 任务 4 收尾；构建完成后需在 Obsidian 中**重载插件**（`main.js` 不热更新）才能看到新空态。
- 一次交付，无中途可演示节点。

## 5. 影响范围

| 文件 | 变更 |
|------|------|
| `src/relations.ts` | 新增 `collectNoteTagState`；`computeRelationGroups` 内部复用（对外行为不变） |
| `src/view.ts` | `render()` 空态三态判定、文案数字化、设置入口跳转 |
| `styles.css` | 空态标题/提示/入口三条样式（朴素灰字，无底色无边框） |
| `doc/ignore-tags.md` | 决策 3 补前向引用 |
| `main.js` | 构建产物（勿手工编辑） |

**不涉及**：忽略标签的匹配语义与配置格式（`normalizeIgnoredTags` / `isIgnoredTag` 不改）、分组计算与排序逻辑、`data.json` 数据结构、`manifest.json`、`src/summary.ts`、网络请求、非空结果的任何展示。

## 6. 风险与已知非阻断项

1. `this.app.setting` 非公开 API：若断言失败或未来被移除，入口退化为纯文字提示，不影响其余功能（点击回调内做判空，不抛错）。
2. 空态分支多一次当前文件的标签遍历（`collectNoteTagState`），仅在 `groups.length === 0` 时发生，规模为单文件标签数，无性能影响；不从 `computeRelationGroups` 扩散返回值，避免改动其签名与既有调用点。
3. 「全被忽略」的判断依赖 `active.length === 0 && total.length > 0`；若未来引入「部分标签被忽略且剩余标签无共享」，仍走第三种分支并显示 `active.length`，符合本次澄清口径。

## Complements

### 任务 1：抽出三态可区分的标签统计函数

- **状态**：✅ 已完成
- **修改文件**：
  - `src/relations.ts` — 新增导出接口 `NoteTagState`（`total/active/ignored`）与 `collectNoteTagState(cache, ignoredTags = [])`：内部 `normalizeIgnoredTags` 归一一次，遍历 `extractTags(cache)` 排序后的标签，用既有 `isIgnoredTag` 二选一划分；`computeRelationGroups` 的 `currentTags` 改为 `new Set(collectNoteTagState(...).active)`，删除其原有的局部 `normalizeIgnoredTags` + `filter`，对外签名与行为不变
- **审查结果**：审查通过（agent agent-75fbec5e，只读）。签名/默认值/返回结构一致；`total` 保留 `#` 前缀且有序；划分只走 `isIgnoredTag`，层级边界语义未变；计算链上 `normalizeIgnoredTags` 仅剩 1 处；`currentTags` 迭代顺序由插入序变排序序，但下游共享集合与分组 key 均自带 `sort()`，随机化等价性验证 219,849 次对比 0 处不一致
- **完成时间**：2026-10-24 23:24

### 任务 2：空态按三种原因分化文案并提供设置入口

- **状态**：✅ 已完成
- **修改文件**：
  - `src/view.ts` — 新增 `SettingManager` 最小接口（`open()` / `openTabById()`）；`render()` 的空结果分支改为调用 `renderEmpty(file)`；新增 `renderEmpty`：按 `total.length === 0` → `active.length === 0` → 兜底 的顺序渲染三态，文案为「当前笔记没有标签」+ 加标签提示 / 「当前笔记的 N 个标签已被全部忽略」+ `<button>` 入口 / 「当前笔记的 N 个标签未与其他文档共享」；入口点击 `setting.open()` 后 `openTabById(this.plugin.manifest.id)`，`setting` 缺失时退化为提示「请到设置中检查「忽略标签」」且不抛错
- **审查结果**：审查通过（agent agent-fc8cabd4，只读）。分支互斥且必有归属（前两支均 `return`，`active`/`ignored` 对 `total` 全覆盖）；数字口径正确（全被忽略用 `total.length`、无共享用 `active.length`，均天然去重）；文案与需求逐字一致；`file === null` 分支、非空渲染、`renderGroup` 折叠逻辑零改动；eslint 无未使用变量
- **完成时间**：2026-10-24 23:26

### 任务 3：空态入口的样式

- **状态**：✅ 已完成
- **修改文件**：
  - `styles.css` — 在 `.tag-relation-empty` 后新增 4 条规则：`.tag-relation-empty-title`（`margin-bottom`）、`.tag-relation-empty-hint`（`--text-faint` + `--font-ui-smaller` + `line-height`）、`.tag-relation-empty-action`（重置主题 button 的 `background/border/box-shadow/padding`，`--text-accent` + `cursor: pointer`，字体 `inherit`）、hover 下划线
- **审查结果**：审查通过（agent agent-705e15b7）。选择器全部带 `.tag-relation-view` 前缀，`git diff` 为纯插入、未触碰分组/文件行/标签 pill；特异性 (0,2,0) 足以压过主题 `button`(≤0,1,1)；仅用 Obsidian CSS 变量，无硬编码颜色，深浅主题均随变量走
- **完成时间**：2026-10-24 23:26

### 任务 4：构建与静态检查

- **状态**：✅ 已完成
- **修改文件**：
  - `main.js` — 构建产物已更新（`LastWriteTime` 2026-10-24 23:27:31）
- **审查结果**：`tsc -noEmit -skipLibCheck` 退出码 0；`eslint .` 退出码 0，仅 1 条既有 warning（`src/settings.ts:33` `prefer-setting-definitions`）；`esbuild production` 退出码 0；产物含 `tag-relation-empty-action`、`openTabById`、`tag-relation-empty-title`×3、`tag-relation-empty-hint`×2
- **完成时间**：2026-10-24 23:27

### 任务 5：同步历史决策文档

- **状态**：✅ 已完成
- **修改文件**：
  - `doc/ignore-tags.md` — 决策 3 同行追加前向更新说明：统一文案已细化为三态，计算层早退行为不变，指向本文档
- **审查结果**：审查通过（agent agent-705e15b7）。前向引用存在且措辞准确（未错误宣称计算层行为改变）；`relations.ts:120-123` 早退逻辑确未改动
- **完成时间**：2026-10-24 23:27

### 完成总结

4 个任务全部通过独立审查，`tsc`/`eslint`/`esbuild` 均 0 error。空结果的三个原因现在各有独立文案：「无标签」提示加标签方式，「全被忽略」显示被忽略标签数并附直达插件设置页的入口，「无共享」显示参与统计的标签数。计算层与忽略标签语义零改动，`computeRelationGroups` 签名未变。

**已知非阻断项**

1. `<button>` 仅重置了 background/border/box-shadow/padding，未重置主题的 `height`，空态底部留白可能略大于纯文本方案（观感问题）。
2. `metadataCache.getFileCache()` 返回 `null`（缓存未建立）时会被判为「当前笔记没有标签」，属瞬时态，`metadataCache.on('changed')` 重渲染后自愈。
3. 决策 3 以指针方式引用本文档，未在旧文档重复 `active.length === 0` 的判定表达式（避免两处口径漂移）。

**未验证项（需人工在 Obsidian 中重载插件后确认）**：三种空态的实际观感、入口点击后设置页定位、深浅主题下的可读性。
