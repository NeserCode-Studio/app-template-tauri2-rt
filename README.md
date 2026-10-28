<div align="center">

<img src="src-tauri/icons/icon.png" width="96" alt="novels-yes 图标" />

# novels-yes

**为中文长篇小说写作准备的本地桌面写作台**

novels-yes 把作品、卷、章、段落、素材、统计和回收站放进同一个本地工作区。
你选择一个文件夹来保存所有内容；应用不需要账号，也不会把书稿存到云服务。

[![Tauri](https://img.shields.io/badge/Tauri-2-blue?style=flat-round&logo=tauri&logoColor=white)](https://tauri.app)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-green?style=flat-round)](https://tauri.app/start/prerequisites/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-round)](LICENSE)

</div>

---

## 主要功能

| 功能       | 你可以做什么                                                           |
| ---------- | ---------------------------------------------------------------------- |
| 长篇结构   | 管理作品、卷、章节和段落，适合多卷、多章和长篇连载                     |
| 段落编辑   | 每段一张卡片，可拆分、合并、返回最新段落；输入未提交的内容暂存在草稿箱 |
| 版本历史   | 每章自动保留最近 20 次保存快照，可以预览和回滚，回滚后仍可撤销         |
| 素材库     | 集中管理人物、地点、物品、关系等设定；正文提及会按类型高亮             |
| 全文搜索   | 一次搜索章节、正文和素材，按作品分组显示上下文                         |
| 进度统计   | 查看每日目标、连续写作天数和近 14 天趋势                               |
| 专注模式   | 在普通、专注、打字机和 Zen 模式之间切换，界面会记住选择                |
| 导入整理   | 导入 TXT / Markdown，自动识别 UTF-8 或 GBK，并支持自动分段和整书重排   |
| 导出发布   | 导出为 TXT 或 Markdown，支持单章、整卷或全书，并提供实时预览           |
| 回收站     | 删除的章节和卷保留在工作区，可搜索、预览、恢复或深度扫描修复           |
| AI 检测    | 使用朱雀 AI 检测章节文本；结果保存在当前章节，重启后仍可查看           |
| 本地 Agent | 通过本机 MCP 让受控的 AI Agent 读取或修改当前工作区                    |

界面支持中文、英文、亮色和暗色主题，可在应用内直接切换。

---

## 快速开始

当前项目通过源码构建桌面应用。首次准备需要安装：

- Node.js 18 或更新版本
- pnpm 9 或更新版本
- Rust stable
- [Tauri 平台依赖](https://tauri.app/start/prerequisites/)

克隆并启动开发版：

```bash
git clone https://github.com/NeserCode-Studio/novels-yes.git
cd novels-yes
pnpm install
pnpm tauri dev
```

首次运行会编译 Rust 依赖，需要等待一段时间。
生成安装包时运行：

```bash
pnpm tauri build
```

构建完成后，安装包位于 `src-tauri/target/release/bundle/`。

> [!NOTE]
> 在浏览器里打开开发服务器只能预览界面；托盘、原生文件读写、AI 凭据库和 MCP 需要 Tauri 桌面环境。

---

## 开始写作

1. 启动应用后创建一个工作区，或打开已有的 novels-yes 工作区文件夹。
2. 在作品库创建作品、卷和章节；也可以导入 TXT / Markdown 文稿。
3. 在编辑器底部输入段落，按回车结束当前段。
4. 需要修改设定时打开素材库，需要查看进展时打开进度面板。
5. 完成后使用导出功能生成 TXT 或 Markdown。

novels-yes 会自动保存章节。顶栏的保存按钮可以在自动保存前立即写入，或保存失败后重试。

### 导入旧稿

支持把 TXT 或 Markdown 文件导入到当前章节，也可以按标题结构导入为新作品。
导入预览会显示编码、段落数和结构；你可以在导入前调整标题和自动分段。

Word、RTF 等专有格式请先另存为纯文本或 Markdown。

---

## 数据保存在哪里

所有小说数据都保存在你选择的工作区文件夹中。常见位置如下：

| 内容        | 位置                        |
| ----------- | --------------------------- |
| 作品与结构  | `works/<作品ID>/`           |
| 章节正文    | `works/<作品ID>/chapters/`  |
| 纯文本视图  | `works/<作品ID>/texts/`     |
| 共享素材库  | `codex/`                    |
| 统计缓存    | `works/<作品ID>/stats.json` |
| AI 检测结果 | `works/<作品ID>/zhuque/`    |
| 回收站      | `.trash/`                   |

> [!IMPORTANT]
> 备份时请备份整个工作区文件夹。`chapters/<章节ID>.json` 是章节内容的唯一事实来源，`texts/` 下的文本是导出视图；只备份 TXT 可能会漏掉段落卡片和版本历史。

你可以把工作区文件夹复制到移动硬盘、本地网络盘或纳入自己的 Git 备份。
迁移工作区时，请使用应用内的“迁移工作区”功能。

---

## AI 文本检测

novels-yes 集成了朱雀 AI 文本检测，用于检查当前章节的 AI 生成占比。

使用方式：

1. 打开 **设置 > AI**，保存腾讯云 EdgeOne Makers API Key。
2. 在编辑页选择 **朱雀AI检测**。
3. 确认合并段落设置后，再次确认是否开始检测。
4. 查看人工、AI、疑似 AI 占比和分段结果。

> [!WARNING]
> 每次新的检测都会调用付费接口，费用由你的腾讯云账号结算。取消确认弹窗不会发送请求。

检测结果会保存在当前章节的工作区文件中。正文或合并段落设置变化后，旧结果会标记为“内容已变化”；重新检测仍需要你手动确认。

API Key 保存在操作系统凭据库中，不写入工作区。支持 Windows Credential Manager、macOS Keychain 和 Linux Secret Service。

---

## 连接本地 AI Agent

打开工作区后，novels-yes 可以启动一个仅监听本机的 MCP 服务，让受控 AI Agent 连接当前工作区。

- 权限分为只读、可写和管理员。
- 高风险操作仍会在应用内弹出审批。
- 工作区关闭、切换或迁移时，MCP 连接会结束。
- MCP 服务只处理当前打开的工作区。

连接方式、客户端配置和故障排查见 [docs/mcp.md](docs/mcp.md)。

---

## 常见问题

**需要联网吗？**

日常写作、保存、搜索和导出不需要联网。只有使用朱雀 AI 检测，或让外部 AI Agent 访问在线服务时才需要网络；本机 MCP 连接本身不需要互联网。

**会把我上传到云端吗？**

应用本身不提供云存储。只有你主动使用 AI 检测时，当前章节文本才会发送到检测服务；外部 Agent 是否会继续发送内容，取决于你选择的客户端、模型和提示词。

**误删章节怎么办？**

删除的内容会先进入工作区回收站。你可以在回收站页面搜索、预览和恢复。

**能直接编辑工作区里的 TXT 文件吗？**

TXT 文件适合阅读和外部交接。请优先在应用内编辑正文；章节事实来源是 JSON 段落卡片。

**重启后结果和草稿还在吗？**

付费检测结果保存在工作区中，重启后仍可查看。未提交草稿保存在应用本地草稿箱中。

---

## 技术栈

Tauri 2 · Rust · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · Radix UI · Zod · MCP
