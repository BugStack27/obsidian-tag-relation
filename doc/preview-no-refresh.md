---
date: 2026-09-21
description: 悬浮预览文档时不再触发关系面板刷新，修复预览导致面板列表反复跳跃的问题
---

# 悬浮预览不更新面板 - 任务规划

## 1. 需求概述

在关系面板（右侧边栏）里悬浮预览某个关联文档时，Page preview 弹层加载该文档会触发 Obsidian 的 `file-open` 事件，而面板当前监听 `file-open` 即切换为「预览文档」的关联列表。当预览文档与当前文档共享标签时，面板还会把预览文档自身再次列进关联里，如此来回，造成面板内容「一直在跳」。

目标：**悬浮预览文档时，面板保持不变**（仍显示真正打开的文档的关联列表）；只有真正打开/切换文档时才更新面板。

## 2. 需求澄清记录

| 模糊点 | 澄清结果 |
|--------|----------|
| 修复范围 | 用户第一轮选择「仅面板内链接触发的预览」；第二轮确认「无需新增设置项，**直接忽略所有预览**」。结合两点，落地语义采用更普适的 **「面板跟随活动文档，所有来源的悬浮预览一律不触发刷新」** |
| 判定依据 | Obsidian API 说明：`file-open` 在「activity file 变化」时触发，文件可位于新叶子、已有叶子或 **embed（含悬浮预览弹层）**；`getActiveFile()` 返回当前激活 leaf 的文件。悬浮预览弹层**不会抢占 active file**，因此 `file === getActiveFile()` 可精确区分「真正的文档切换」与「预览加载」 |
| 实现位置 | 仅改 `src/view.ts` 中的 `file-open` 事件回调，过滤非活动文档的更新 |

### 派生设计决策

1. **用 `getActiveFile()` 过滤而非改事件源**：`file-open` 回调只携带 `TFile` 参数，无来源信息。最可靠的判别是「该文件是否是当前激活文档」。若 `file !== workspace.getActiveFile()`，说明这次打开来自非激活上下文（悬浮预览弹层、文件树预览等），跳过刷新。
2. **不动事件源/不拆 preview 来源判定**：虽然 `hover-link` 只由面板自身发出，但 Obsidian 的 Page preview 核心插件接管了弹层生命周期，插件无法拿到弹层关闭时刻。改用 active-file 过滤对所有来源的预览统一生效，行为一致且无需在 trigger preview 时维护状态。
3. **真正的标签变化 / 文档切换仍会刷新**：`metadataCache 'changed'`、`vault 'rename'`、以及用户真实切换文档（此时 actives file 变化）仍照常 `scheduleRefresh()`，行为不受影响。
4. **`currentFile` 更新逻辑**：仅在 `file === getActiveFile()` 时更新 `this.currentFile` 并刷新；否则忽略本次 `file-open`。
5. **不新增设置项、不改 relations/summary/settings**：改动收敛在 view.ts 一个回调内，无持久化格式变更，向后兼容。

## 3. 任务列表

### 任务 1：在文件打开回调中过滤非活动文档

| 属性 | 值 |
|------|-----|
| **描述** | 修改 `src/view.ts` 的 `onOpen()` 中 `this.app.workspace.on('file-open', ...)` 回调：仅当 `file && file === this.app.workspace.getActiveFile()` 时才 `this.currentFile = file; this.scheduleRefresh();`，否则直接忽略（`file === null` 的场景维持现状照常处理，不更新当前文件）。 |
| **依赖关系** | 无 |
| **验收标准** | 悬浮预览任意关联文档时面板列表不再变化；真正打开/切换文档后面板正常更新；标签变更、重命名仍触发刷新。 |

### 任务 2：构建与静态检查

| 属性 | 值 |
|------|-----|
| **描述** | 执行 `npm run build` 与 `npm run lint`，更新插件根目录 `main.js`。 |
| **依赖关系** | 任务 1 |
| **验收标准** | `npm run build` 退出码 0 且 `main.js` 已更新；`npm run lint` 无新增 error/warning（允许保留既有 `getSettingDefinitions` warning）。 |

## 4. 执行顺序

```
任务 1 → 任务 2
```

任务 1、2 严格串行，改动极小，一次性交付。

## 5. 影响范围

| 文件 | 变更 |
|------|------|
| `src/view.ts` | `file-open` 回调增加 `file === this.app.workspace.getActiveFile()` 判断 |
| `main.js` | 构建产物（勿手工编辑） |

**不涉及**：`src/relations.ts`、`src/summary.ts`、`src/settings.ts`、`styles.css`、`manifest.json`、设置项、网络请求、数据持久化。

## 6. 验证要点（人工在 Obsidian 中确认）

- 主编辑器打开文档 A，面板显示 A 的关联列表。
- 在面板中悬浮预览某个关联文档 B，面板应**保持 A 的列表不动**，不跳成 B 的列表、也不出现「反复跳」。
- 点击面板内文档、或真实打开其他文档，面板应正常切换到新文档的关联列表。
- 编辑文档修改标签后，面板照常刷新。

## Complements

### 任务 1：在文件打开回调中过滤非活动文档

- **状态**：✅ 已完成
- **修改文件**：
  - `src/view.ts` — `onOpen()` 中 `file-open` 回调新增守卫：`if (file && file !== this.app.workspace.getActiveFile()) return;`，仅在文件是当前激活文档时才更新 `currentFile` 并 `scheduleRefresh()`；`file === null` 维持原行为。`metadataCache 'changed'` 与 `vault 'rename'` 刷新保留不动。
- **审查结果**：审查通过（agent general-purpose-1）。逐条核验 5 项验收标准符合：预览弹层加载 `file-open` 被过滤、真实切换仍刷新、标签/重命名刷新保留、`null` 场景保持原行为、真实切换时序不会误过滤。
- **完成时间**：2026-09-21

### 任务 2：构建与静态检查

- **状态**：✅ 已完成
- **修改文件**：
  - `main.js` — 构建产物已更新（esbuild production）
- **审查结果**：`npm run build` 退出码 0；`npm run lint` 0 error，仅剩既有 1 条 `prefer-setting-definitions` warning（非本次引入）。
- **完成时间**：2026-09-21

### 独立行为验证

用 Node 复现过滤分支逻辑执行 3 个用例：

```
switch to active: true    // 真实切换 → 刷新
preview b (not active): false  // 预览非活动文档 → 不刷新
null: true                // 无活动文件 → 维持原行为
```

与验收标准一致：悬浮预览不触发刷新，真实文档切换仍刷新，`null` 兜底不受影响。

### 完成总结

2 个任务全部完成并通过独立审查，构建 lint 均 0 error。改动收敛在 `src/view.ts` 单一回调内：面板现只跟随真正的活动文档，悬浮预览不再导致面板跳至预览文档的关联列表。`main.js` 已更新，可在 vault 中重载插件生效。

**待人工确认（需在 Obsidian 中验证）**：面板悬浮预览时列表保持不动；点击/真实切换仍正常更新；修改标签仍刷新。

### 扩展：中键点击在新标签打开并跟随面板

- **状态**：✅ 已完成
- **修改文件**：
  - `src/view.ts` — `renderFileRow()` 中为面板链接新增 `auxclick` 事件监听：当 `event.button === 1`（鼠标中键/滚轮点击）时 `preventDefault()` 并在新标签激活打开文档（`getLeaf(true).openFile(file)`），与 `Ctrl+点击` 行为一致，面板随后跟随新文档更新。
- **审查结果**：`npm run build` 退出码 0；`npm run lint` 0 error，仅剩既有 `prefer-setting-definitions` warning（非本次引入）。
- **完成时间**：2026-09-21