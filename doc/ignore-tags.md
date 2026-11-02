---
date: 2026-09-16
description: 新增「忽略标签」配置，被忽略的标签不在关联标签面板的分组标题中展示
---

# 忽略标签配置 - 任务规划

## 1. 需求概述

在插件设置页新增「忽略标签」配置项，用于声明一批不参与关联统计的标签。被忽略的标签在关联计算开始前即被剔除，**等同于该标签不存在**：既不作为共享标签参与判定，也不进入分组 key。

典型场景：`#private`、`#todo`、`#draft` 这类元数据标签在每个文档上都存在，会把分组标题刷满噪音，并让不同文档因这些噪声标签产生虚假的「共享标签」关联。

## 2. 需求澄清记录

| 模糊点 | 澄清结果 |
|--------|----------|
| 配置方式 | **多行文本域，一行一个标签**。保存时按行解析为数组 |
| 「不统计」语义 | **全局剔除，完全透明**（用户于开发中途修正）：忽略标签在计算前从标签集合中剔除，不参与共享标签判定、不参与分组 key、不参与展示。因此不存在「空展示分组」，也不会产生仅因忽略标签而建立的关联 |
| 层级标签匹配 | **支持前缀匹配**：配置 `private` 时，`private`、`private/secret`、`private/a/b` 全部忽略 |
| 书写格式 | **带不带 `#` 都兼容**：`private` 与 `#private` 等价，保存时统一规范化为 `private` |

### 派生设计决策（实现时遵循，审查时核对）

1. **剔除点选在 `currentTags`**：只对当前文档的标签集合做剔除即可。因为共享标签是由 `currentTags` 与目标文档标签求交集得来的，`currentTags` 里不存在忽略标签时，忽略标签自然无法出现在任何 `sharedTags` 中，无需再遍历过滤其他文档。
2. **`RelationGroup` 结构不变**：不需要新增 `displayTags` 字段。`sharedTags` 本身就是剔除后的结果，分组 key、折叠状态、展示三者天然一致。
3. **无关联的判定**：若当前文档剔除忽略标签后标签集合为空，直接返回 `[]`，面板显示「没有找到共享标签的关联文档」。（2026-10-24 前向更新：该统一文案已细化为「无标签 / 标签全被忽略 / 无共享」三态，第三态显示参与统计的标签数、第二态提供打开本设置的入口，判定口径见 `doc/empty-state-messages.md`；本决策的**计算层早退行为不变**，仅文案分化。）
4. **孤立文档的消失是预期行为**：若某文档与当前文档**仅**共享被忽略的标签，该文档不再出现在结果中。这是「不统计」的正确含义。
5. **匹配大小写不敏感**：与 Obsidian 标签匹配行为保持一致，比较时统一转小写。
6. **边界语义**：`private` 匹配 `private` 与 `private/x`，但**不匹配** `privateX`（即按 `prefix + '/'` 边界判断，而非裸 `startsWith`）。

## 3. 任务列表

### 任务 1：新增忽略标签设置项

| 属性 | 值 |
|------|-----|
| **描述** | 在 `TagRelationSettings` 接口新增 `ignoredTags: string[]`，`DEFAULT_SETTINGS` 中默认 `[]`。在 `TagRelationSettingTab.display()` 中新增 `Setting`，使用 `addTextArea` 渲染多行输入（`rows = 5`，placeholder 给示例 `例如 private、#todo、草稿/待办`）。`onChange` 时用 `normalizeIgnoredTags` 归一后写回设置、`saveSettings()`，并触发面板刷新。描述文案需表达**新语义**：被忽略的标签不参与关联统计，等同于不存在。 |
| **依赖关系** | 无（与任务 2 并行；实际先做任务 2 以复用归一函数） |
| **验收标准** | 设置页出现多行文本域；输入多个标签后保存，重启 Obsidian 后配置仍在（`data.json` 中出现 `ignoredTags`）；面板刷新 |

> **实现说明（相对初版方案的偏差）**：`refreshViews()` 会触发全库扫描，若逐字符触发会明显卡顿。故 `onChange` 中「保存」是立即的，「面板刷新」改为 **300ms 防抖**（`scheduleRefresh()`），并在 `hide()` 中清理定时器。这不影响「配置后面板更新」的验收标准，且符合 `AGENTS.md` 关于对昂贵操作做 debounce 的要求。

### 任务 2：实现忽略标签解析与匹配工具

| 属性 | 值 |
|------|-----|
| **描述** | 在 `src/relations.ts` 新增两个纯函数：<br>① `normalizeIgnoredTags(input: string \| string[]): string[]` — 逐项 `trim`、去掉前导 `#`、跳过空项、转小写、去重后返回；<br>② `isIgnoredTag(tag: string, ignored: string[]): boolean` — 按 `tag.toLowerCase()` 与 `ignored` 做**前缀 + `/` 边界**匹配（`t === p \|\| t.startsWith(p + '/')`）。<br>忽略标签的匹配基准为不带 `#` 的标签名（与 `RelationGroup.sharedTags` 的现有格式一致）。 |
| **依赖关系** | 任务 1（消费其设置类型） |
| **验收标准** | 传入 `"private\n#TODO\n\nprivate"` 返回 `["private","todo"]`；`isIgnoredTag('private/a', ['private'])` 为 `true`，`isIgnoredTag('privateX', ['private'])` 为 `false` |

### 任务 3：在关联计算中剔除忽略标签

| 属性 | 值 |
|------|-----|
| **描述** | 修改 `computeRelationGroups` 签名，新增可选参数 `ignoredTags: string[] = []`，入口处调用 `normalizeIgnoredTags` 归一。<br>实现：把当前文档的标签集合改为**剔除忽略标签后的集合**（`extractTags(...)` 结果 filter 掉 `isIgnoredTag` 命中的项）。后续「共享标签求交集」「分组 key 计算」「组内排序」逻辑**保持原样不变**。<br>`RelationGroup` 接口**不改**（无 `displayTags`）。<br>剔除后 `currentTags.size === 0` 时沿用现有早退逻辑返回 `[]`。 |
| **依赖关系** | 任务 2 |
| **验收标准** | 配置 `private` 前后：仅共享 `#private` 的文档从结果中消失；共享 `{private, a}` 与 `{a}` 的文档**合并进同一分组**（因 `private` 已不存在）；`sharedTags` 中不含任何被忽略标签 |

### 任务 4：面板传入忽略配置

| 属性 | 值 |
|------|-----|
| **描述** | 在 `src/view.ts` 的 `render()` 中，把 `this.plugin.settings.ignoredTags` 作为第 4 个参数传入 `computeRelationGroups`。<br>`renderGroup` **无需改动**（`sharedTags` 已是剔除后的结果，分组 key 与展示仍统一使用它）。 |
| **依赖关系** | 任务 3 |
| **验收标准** | 面板行为随设置项变化；分组折叠/展开状态、组内排序、标签点击搜索等既有功能不受影响 |

### 任务 5：构建与静态检查

| 属性 | 值 |
|------|-----|
| **描述** | 执行 `npm run build` 与 `npm run lint`，确认无新增错误；更新插件根目录构建产物 `main.js`。 |
| **依赖关系** | 任务 1-4 |
| **验收标准** | `npm run build` 退出码 0 且 `main.js` 已更新；`npm run lint` 无新增 error/warning（允许保留既有的 `getSettingDefinitions` warning） |

## 4. 执行顺序

```
任务 1 ──┐
         ├─→ 任务 3 ─→ 任务 4 ─→ 任务 5
任务 2 ──┘
```

- 任务 1、任务 2 相互独立，可并行（实际采用先 2 后 1，避免解析逻辑重复实现）。
- 任务 3 需两者就绪（依赖设置类型与匹配工具）。
- 任务 4 → 5 严格串行。
- 一次性交付，无中途可演示节点。

## 5. 影响范围

| 文件 | 变更 |
|------|------|
| `src/settings.ts` | 新增 `ignoredTags` 字段与设置项 UI |
| `src/relations.ts` | 新增 `normalizeIgnoredTags`、`isIgnoredTag`；`computeRelationGroups` 加参数并剔除 `currentTags` |
| `src/view.ts` | `render()` 传入 `ignoredTags` |
| `main.js` | 构建产物（勿手工编辑） |

**不涉及**：`styles.css`（不再需要空分组占位样式）、`src/summary.ts`、`manifest.json`、网络请求、数据持久化格式（向后兼容：`Object.assign` 兜底默认 `[]`，旧 `data.json` 无需迁移）。

## Complements

### 任务 2：实现忽略标签解析与匹配工具

- **状态**：✅ 已完成
- **修改文件**：
  - `src/relations.ts` — 新增私有辅助 `normalizeTagName`（去 `#`、trim、转小写），导出 `normalizeIgnoredTags(input: string | string[])`（按行/数组解析、跳过空白、去重、归一）与 `isIgnoredTag(tag, ignored)`（`t === p || t.startsWith(p + '/')` 边界匹配，大小写不敏感）
- **审查结果**：审查通过（agent general-purpose-1，3m06s）。8 个真实 Node 执行用例全部符合，含空行跳过、去重、去 `#`、转小写、`prefix + '/'` 边界匹配、大小写不敏感、空白安全忽略
- **完成时间**：2026-09-16 09:16

### 任务 1：新增忽略标签设置项

- **状态**：✅ 已完成
- **修改文件**：
  - `src/settings.ts` — `TagRelationSettings` 新增 `ignoredTags: string[]`；`DEFAULT_SETTINGS` 新增 `ignoredTags: []`；新增 `Setting`「忽略标签」，`addTextArea`（`rows = 5`，placeholder `例如 private、#todo、草稿/待办`），`onChange` 用 `normalizeIgnoredTags` 归一写回 + `saveSettings()` + 300ms 防抖 `scheduleRefresh()`；新增 `hide()` 重写清理定时器
  - 顺带修正该文件原有的一处缩进错乱（组内排序 / 彩虹颜色两个 Setting 的多余缩进层级），无逻辑变更
- **审查结果**：审查通过（agent general-purpose-2，53s）。描述文案符合新语义；`ignoredTags` 归一存储；向后兼容（`Object.assign` 兜底 `[]`）；`hide()` 已清理定时器；无新增类型错误。3 处不阻断偏差：`rows=5`（外观）、`refreshViews` 改防抖（可接受，AGENTS.md 要求 debounce 昂贵操作）、placeholder 文案与文档表格字面不同（`setDesc` 已含等价说明）
- **完成时间**：2026-09-16 09:19

### 任务 3：在关联计算中剔除忽略标签

- **状态**：✅ 已完成
- **修改文件**：
  - `src/relations.ts` — `computeRelationGroups` 新增第 4 个可选参数 `ignoredTags: string[] = []`；入口处 `normalizeIgnoredTags` 归一后，把 `extractTags(...)` 结果 filter 掉命中 `isIgnoredTag` 的项再构造 `currentTags`；后续求交集、分组 key、组内排序逻辑完全未改；`RelationGroup` 接口未改（无 `displayTags`）
- **审查结果**：审查通过（agent general-purpose-3，2m03s）。参数顺序/默认值正确；剔除发生在求交集之前且仅过滤 `currentTags`（审查确认该推理无遗漏路径，`related` 循环只遍历 `currentTags`）；`RelationGroup` 无 `displayTags`。审查方独立用 esbuild+node 执行 6 个用例（基线、合并+消失、仅忽略标签者消失、层级前缀边界、大小写/`#` 变体、全部忽略返回空），输出与验收标准逐一吻合
- **完成时间**：2026-09-16 09:20

### 任务 4：面板传入忽略配置

- **状态**：✅ 已完成
- **修改文件**：
  - `src/view.ts` — `render()` 中 `computeRelationGroups` 调用改为多行形式并传入 `this.plugin.settings.ignoredTags`；`renderGroup` 未改动（折叠 key 仍用 `sharedTags`）
- **审查结果**：审查通过（同 agent general-purpose-3）。全项目仅 1 处 `computeRelationGroups` 调用点且已正确传参；`renderGroup` 折叠 key 未改动
- **完成时间**：2026-09-16 09:20

### 任务 5：构建与静态检查

- **状态**：✅ 已完成
- **修改文件**：
  - `main.js` — 构建产物已更新（esbuild production，2026-09-16 09:20:32）
- **审查结果**：`tsc -noEmit -skipLibCheck` 退出码 0；`node esbuild.config.mjs production` 退出码 0；`eslint .` 退出码 0，仅剩 1 条既有 warning（`obsidianmd/settings-tab/prefer-setting-definitions`，属插件既有问题，非本次引入）
- **完成时间**：2026-09-16 09:20

### 独立行为验证（超出发任务范围的自检）

用 esbuild 把 `src/relations.ts` 打包（`--alias:obsidian=<stub>`）后喂入假 vault 真实执行，验证结果：

```
BEFORE ignoring: (4 groups)
    [a, b] -> D
    [a, private] -> B
    [a] -> E
    [private] -> C
AFTER ignoring "private": (2 groups)
    [a, b] -> D
    [a] -> B, E
```

与验收标准一致：仅共享 `#private` 的 `C` 消失；`B([a,private])` 与 `E([a])` 因 `private` 被剔除而**合并**为同组 `[a]`。`#private` / `PRIVATE` 写法等价；全部忽略后返回 0 组。

### 完成总结

5 个任务全部通过独立审查，构建与 lint 均为 0 error。需求在开发中途由用户修正为「忽略标签完全不参与共享标签判定与分组 key」（全局剔除、完全透明），实现与文档已按新语义对齐。产物：`main.js` 已更新，可直接在 vault 中重载插件生效。

**已知非阻断项（留待后续可选处理）**

1. `ignoredTags` 存储时统一转小写，层级标签中的大小写会在设置框回显时被小写化（匹配不受影响，仅显示）。
2. 忽略标签的变更未进入 Obsidian 的声明式设置 API（`getSettingDefinitions`），该 warning 为插件既有问题。

**未验证项（需人工在 Obsidian 中确认）**：设置页控件实际交互、面板渲染与样式、重载插件后的持久化落盘。
