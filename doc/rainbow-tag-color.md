---
date: 2026-09-09
description: 在标签关系面板中为标签胶囊添加可配置的彩虹配色
---

# 标签彩虹配色 - 任务规划

## 1. 需求概述

在插件设置页新增一个开关「标签使用彩虹颜色」。开启后，标签关系面板内的标签胶囊使用固定的内置彩虹色调渲染。状态变更即时生效并持久化。

## 2. 需求澄清记录

| 模糊点 | 澄清结果 |
|--------|----------|
| 配色分配规则 | **同标签恒同色**：基于标签名哈希映射到固定彩虹调色板，同一标签在面板任何位置始终同一颜色 |
| 作用范围 | **仅面板标签 pill**：只影响面板内渲染的标签胶囊，不影响正文或全局标签 |
| 调色板 | **固定内置彩虹色**：使用固定的鲜艳彩虹色（红橙黄绿蓝靛紫），设置仅一个开关 |

## 3. 任务列表

### 任务 1：新增彩虹配色设置项

| 属性 | 值 |
|------|-----|
| **描述** | 在 `TagRelationSettings` 接口中新增 `rainbowTags: boolean`，默认 `false`（DEFAULT_SETTINGS 同步更新）。在设置页 `TagRelationSettingTab.display()` 中新增一个开关「标签使用彩虹颜色」，onChange 时保存设置并调用 `plugin.refreshViews()`。 |
| **依赖关系** | 无 |
| **验收标准** | 设置页出现新开关；切换后设置持久化，面板立即重新渲染 |

### 任务 2：实现彩虹配色分配与样式

| 属性 | 值 |
|------|-----|
| **描述** | 在 `renderTag` 中，当 `plugin.settings.rainbowTags` 为真时，为标签元素设置彩虹色。做法：根据标签名计算稳定的哈希，映射到固定彩虹色板中的一个颜色索引，设置内联 CSS 变量（如 `--tag-bg`、`--tag-color`）。在 `styles.css` 为 `.tag-relation-tag` 增加基于该变量渲染背景色/文字色的规则（作为默认样式的覆盖）。 |
| **依赖关系** | 任务 1 |
| **验收标准** | 开启开关后，同标签颜色一致、不同标签颜色不同、整体呈彩虹色；关闭后恢复原主题样式 |

## 4. 执行顺序

任务 1 → 任务 2（任务 2 依赖任务 1 的设置项）。

## Complements

### 标签彩虹配色
- **状态**：✅ 已完成
- **修改文件**：
  - `src/settings.ts` — 接口新增 `rainbowTags: boolean`（默认 false）；设置页新增开关「标签使用彩虹颜色」，onChange 保存并 `refreshViews()`
  - `src/view.ts` — 新增 FNV-1a 哈希 `hashString`、固定 7 色 `RAINBOW_COLORS` 与 `rainbowColor`；`renderTag` 在开关开启时设置内联 `--rainbow-bg`/`--rainbow-color`
  - `styles.css` — `.tag-relation-tag` 背景/文字色改用 `var(--rainbow-bg/--rainbow-color, fallback…)`，未开启时无残留回退原主题样式
- **审查结果**：审查通过（agent 2a59011a）。任务 1、任务 2 均达标
- **构建**：`npm run build` 通过；`npm run lint` 仅 1 条既有 warning（getSettingDefinitions）
- **完成时间**：2026-09-09