# Tag Relation

为 Obsidian 增加一个右侧面板，列出与当前笔记**共享标签**的其他笔记，并按「共享标签集合」分组。

面板会跟随你当前打开的笔记自动刷新，方便沿着标签在笔记之间跳转。

## 功能

- **按共享标签分组**：共享标签完全相同的笔记归为一组；分组按共享标签数量降序排列，再按标签名排序。
- **组内排序**：可选文件名称、创建时间、修改时间（时间均为新的在前），面板标题栏也可临时切换。
- **显示路径 / 摘要**：可显示笔记所在文件夹，以及在笔记下方显示首段内容作为简要信息，摘要长度可调（20–300 字符）。
- **彩虹标签**：按标签名生成稳定的颜色，不同标签显示不同颜色，仅影响本插件面板。
- **忽略标签**：被忽略的标签不参与关联统计，既不作为共享标签，也不参与分组，等同于该标签不存在。支持层级前缀匹配，例如配置 `private` 会同时忽略 `private/secret`；匹配不区分大小写，带不带 `#` 均可。
- **交互**：点击笔记打开，`Ctrl`/`Cmd` 点击或鼠标中键在新标签页打开；点击标签跳转到全局搜索的 `tag:标签名`；安装并启用核心插件 **Page preview** 后可悬浮预览笔记。
- **空状态说明**：面板会区分「当前笔记没有标签」「标签被全部忽略」「标签未与其他笔记共享」三种情况，并给出对应提示。

## 安装

本插件通过 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 安装。

1. 在 **设置 → 第三方插件** 中关闭安全模式，安装并启用 **BRAT**。
2. 打开 **BRAT** 的设置，选择 **Add Beta plugin**。
3. 填入仓库地址：

   ```
   bugstack27/obsidian-tag-relation
   ```

4. 确认并等待 BRAT 拉取最新 Release，然后在 **设置 → 第三方插件** 中启用 **Tag Relation**。

手动安装：从 [Releases](https://github.com/bugstack27/obsidian-tag-relation/releases) 下载 `main.js`、`manifest.json`、`styles.css`，放入 `<库>/.obsidian/plugins/tag-relation/`，重启 Obsidian 后启用。

> BRAT 安装的是已发布的 Release。如果 Release 仍是 draft，需要先手动发布。

## 使用

启用后，插件会在右侧边栏打开「标签关系」面板，也可以在命令面板执行 **打开标签关系面板**，或点击左侧功能区图标。

面板推荐的用法：

1. 打开一篇带标签的笔记。
2. 在右侧查看共享标签的笔记分组。
3. 点击笔记逐个跳转，或点击某个标签直接搜索同类内容。

## 设置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| 显示路径 | 开 | 在关联笔记旁显示所在文件夹路径 |
| 显示简要信息 | 开 | 在关联笔记下方显示首段内容 |
| 简要信息长度 | 80 | 摘要最多显示的字符数（20–300） |
| 组内排序 | 文件名称 | 可选文件名称、创建时间、修改时间 |
| 标签使用彩虹颜色 | 关 | 按标签名生成稳定颜色 |
| 忽略标签 | 空 | 每行一个标签，支持层级前缀，不区分大小写 |

## 隐私

- 完全本地运行，**不发起任何网络请求**，不收集、不上传任何数据。
- 只读取当前库内 Markdown 笔记的元数据，以及在开启「显示简要信息」时读取笔记首段文本用于展示。
- 设置保存在插件数据文件 `data.json` 中，不会写入笔记。

## 兼容性

- Obsidian `1.7.2` 及以上。
- 桌面端与移动端均可使用。
- 面板的悬浮预览依赖核心插件 **Page preview**（开启后自动生效）。

## 开发

```bash
npm install     # 安装依赖
npm run dev     # 监听编译，生成 main.js
npm run build   # 类型检查 + 生产构建
npm run lint    # ESLint 检查
```

源码位于 `src/`，构建产物为 `main.js`（不纳入版本控制）。

本地调试时，把 `main.js`、`manifest.json`、`styles.css` 复制到 `<库>/.obsidian/plugins/tag-relation/`，重载 Obsidian 即可。

## 发布

```bash
npm version patch   # 同步更新 package.json、manifest.json、versions.json，并打 tag
git push --follow-tags
```

推送 tag 后，GitHub Actions 会执行类型检查与构建，生成 `main.js`、`manifest.json`、`styles.css` 的 Release（draft），并记录构建证明。确认无误后手动发布该 Release。

## 许可

[0-BSD](LICENSE)
