<div align="center">

# novels-yes

**Tauri 2 + React 19 本地优先纯文本小说写作工具**

面向中文长篇创作者的写作应用：把小说的结构（作品 / 卷 / 章 / 场景）做成一等公民，正文以纯文本落盘，不绑架用户数据。基于 app-template（Tauri 2 桌面框架）扩展，复用其窗口管理、系统托盘、命令面板、设置中心与多语言能力，并在其上构建小说专属的编辑器、结构树、素材库与进度统计。

[![Tauri](https://img.shields.io/badge/Tauri-2-blue?style=flat-round&logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-round&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-round&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-round&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-round)](LICENSE)

</div>

---

## 特性

| | |
| --- | --- |
| **本地优先** | 正文明文落盘（UTF-8），随时可被 Git 或任意编辑器接管，应用不绑定用户数据 |
| **结构驱动** | 作品 / 卷 / 章 / 场景是可导航实体，统计与检索建立在这层结构之上 |
| **自研卡片式编辑器** | 章内容为卡片列表，底部常驻唯一输入框，回车固化卡片；重算收敛到单卡 |
| **不丢稿的暂存段落** | 写新段落时点开旧卡片，草稿自动暂存并可随时取回；编辑旧段落后自动归位（按章存入 localStorage） |
| **拼合有依据** | 段末无句读时拒绝拼合，避免把两段硬接成一句；拼合可一键撤回 |
| **章即页** | 默认单章视野，上滑上一章、下滑下一章，右栏提供翻章按钮 |
| **素材库** | 工作区级共享的人物 / 地点 / 物品等条目，带类型化字段与双向关联；正文中提及按类型配色自动高亮（可关） |
| **全站搜索** | 一次搜索覆盖章标题、正文与素材条目，命中高亮 |
| **进度统计** | 今日目标、连续写作天数与近 14 天曲线；作品字数以章文件全量重算 |
| **专注 / 打字机 / Zen** | 三种视图模式，互斥切换并记忆选择 |
| **导出** | 单章或全书导出为 txt，标题 / 缩进 / 换行风格可选，带实时预览 |
| **回收站** | 删除的章先落到工作区 `.trash/`，可恢复（结构树一并补回） |

技术底座：**Tauri 2** · **React 19** · **TypeScript** · **Tailwind CSS 4** · **shadcn/ui** · **Radix UI** · **Rust**

---

## 快速开始

### 环境要求

- Node.js ≥ 18
- pnpm ≥ 9
- Rust（stable）
- Tauri 平台依赖（Linux 需 `webkit2gtk` 等，详见[官方文档](https://tauri.app/start/prerequisites/)）

### 安装与启动

```bash
# 安装前端依赖
pnpm install

# 启动开发环境（自动编译 Rust，首次较慢）
pnpm tauri dev
```

### 构建

```bash
pnpm tauri build     # 生成安装包
pnpm build           # 仅构建前端
```

### 其他命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动前端开发服务器（端口 8888） |
| `pnpm preview` | 预览前端构建产物 |
| `pnpm lint` | ESLint 检查 |
| `pnpm format` | Prettier 格式化 |

> 浏览器环境下界面可渲染，但托盘、跨窗口、原生能力不可用 —— 这些需 `pnpm tauri dev` 验证。

---

## 项目结构

```
src/
├── main.tsx              # 入口
├── App.tsx               # 根组件：路由装配、Context、跨窗口事件、生命周期触发
├── App.css               # 设计令牌 + 组件类
│
├── components/
│   ├── framework/        # 框架组件（标题栏、命令面板、设置、关于、托盘菜单）
│   └── ui/               # shadcn/ui 组件库
│
├── views/                # 页面
│   ├── Library           # 作品库（M1）
│   ├── Editor            # 编辑器（三栏：结构树 / 卡片区 / 章节操作）
│   └── TrayMenu          # 托盘菜单
│
├── composables/          # 业务 Hook（useTheme / useI18n / useToast / useSuperCommand）
├── contexts/             # 全局 Context（workspace / library / outline / codex / viewmode / preferences）
├── lifecycle/            # 生命周期总线（阶段：mount / ready）
├── lib/                  # 工具与资源
│   ├── i18n.resource.ts  # 中英文案表
│   ├── window.utils.ts   # 窗口工具
│   ├── editor.actions.ts # 编辑命令
│   ├── logger.ts         # 日志模块
│   └── utils.ts          # cn()
├── services/             # 业务服务（fs 桥 / 作品 / 结构树 / 章 / 素材 / 统计 / 回收站 / 导入 / 导出）
└── shared/               # 共享 schema（zod，前端与磁盘契约）

src-tauri/
├── tauri.conf.json       # 窗口与打包配置（productName: novels-yes）
├── capabilities/         # 权限白名单（dialog / fs）
└── src/
    ├── lib.rs            # 托盘与 Rust 命令注册
    ├── fs_bridge.rs      # 工作区内读写（拒绝 .. 逃逸与软链）
    └── export_bridge.rs  # 导出写工作区外 / 导入编码探测
```

---

## 架构说明

### 双窗口模型

配置了两个窗口，**同一份前端代码按窗口标签分流**：

| 窗口 | 用途 |
| --- | --- |
| `main` | 主界面：无边框、可拖拽标题栏、路由内容 |
| `tray` | 托盘弹出菜单：独立小窗、失焦自动隐藏 |

托盘右键 → Rust 侧发出定位事件 → 主窗口计算坐标后弹出托盘菜单；托盘菜单中的操作通过事件反向通知主窗口。

### 生命周期系统

提供阶段化钩子，让初始化逻辑有明确落点：

```
mount（React 挂载完成） → ready（应用就绪）
```

钩子支持优先级排序、一次性执行、卸载函数。同阶段按优先级顺序 `await` 执行，行为可预测。

内置两个阶段对应两个真实触发点（均在 `App.tsx` 的挂载 effect 内按序触发）：

| 阶段 | 时机 | 典型用途 |
| --- | --- | --- |
| `mount` | React 挂载完成 | 注册全局事件监听、启动定时任务 |
| `ready` | 挂载完成后 | 需要窗口就绪才能执行的动作（聚焦、置前） |

需要扩展时，在 `src/lifecycle/types.ts` 的 `LifecycleStage` 联合类型里加阶段，并在合适位置补上 `lifecycle.fire(...)`，`register` / `fire` 的实现无需改动。

### 状态与持久化

- 全局状态用 React Context，value 统一经 `useMemo` 固定引用，避免无关状态引发全量重渲染
- 用户偏好（主题、语言、标题、置顶状态等）持久化到 `localStorage`
- 弹窗开关状态集中在根组件，通过 Context 下发

#### 正文与磁盘的分工

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 作品清单 / 元数据 | `works/<id>/work.json` | 标题、类型、归档状态 |
| 结构树 | `works/<id>/outline.json` | 卷 / 章节点，扁平数组 + `parentId` |
| 章正文 | `works/<id>/chapters/<id>.json` | **唯一事实来源**，`cards` 数组 |
| 章纯文本视图 | `works/<id>/texts/<id>.txt` | 由 `cards` 生成，供导出 / 外部编辑 |
| 素材条目 | `codex/entries/<id>.json` | **工作区级共享**，与 `works/` 同级 |
| 素材类型配置 | `codex/types.json` | 显示名、字段、每种类型的高亮颜色 |
| 统计 | `works/<id>/stats.json` | 作品字数以章文件全量重算，缓存只作加速 |
| 回收站 | `.trash/<itemId>.json` + 数据文件 | 只在工作区内，拷走工作区即跟着走 |

两条容易踩的约束，改动相关代码前务必留意：

1. **结构树里的章 id 必须等于章文件名的 id。** 打开哪一章由结构树 id 决定，正文按 `chapters/<id>.json` 读取。两者若各自生成随机 id，打开章节就会读到一个不存在的文件，表现为「保存成功但重进是空章」。`addNode` 因此支持传入 `id`，建章时复用章文件自身的 id。
2. **章正文是 `cards` 数组，不是整段字符串。** 一张卡片承载一段文本；拆分在标点处切开、拼合把两张并成一张，都只改动 `cards`。
3. **素材库属于工作区，不属于作品。** 同一个人物、地点会横跨多部作品复用，按作品各存一套必然分裂成互不相识的两份设定。旧版 `works/<id>/codex/` 在首次装载时会自动复制进 `codex/`，只复制不删除；同名条目只报告不自动合并。

#### 保存时机

输入框回车固化卡片后，防抖 800ms 落盘（`AUTOSAVE_DELAY`）。除此之外：

- 顶栏「保存」按钮常驻可点，用于在防抖窗口内强制落盘，或在失败后重试
- 组件卸载时冲刷待写内容——切换章节 / 返回作品库都会卸载编辑器，只清定时器会丢数据
- 切换章节后焦点直接落在底部输入框，无需先点卡片
- 落盘失败会弹 `Editor.save.failed`，此时不要依赖自动保存

暂存的新段落只进 `localStorage`（键 `novels-yes:draft:<workId>:<chapterId>`），**不进工作区目录**：它是没写完的半成品，混进 `works/<id>/` 会污染用户导出的文本。按章隔离，切回来能接着写。

#### 两条边界：工作区内 vs 工作区外

Rust 侧刻意分成两个桥，作用域相反：

| 桥 | 作用域 | 用途 |
| --- | --- | --- |
| `fs_bridge` | **仅工作区内** | 应用读写自身数据。拒绝 `..` 逃逸与符号链接。 |
| `export_bridge` | 工作区外任意绝对路径 | 导出成品、导入既有文稿。目标由系统对话框给出，不做工作区校验。 |

两者混用会造成实质漏洞——若导出复用 `fs_bridge`，用户就能借导出把文件写到工作区之外。

### 主题机制

- CSS 变量驱动，所有颜色集中在 `App.css` 定义，亮/暗两套令牌
- 首次启动跟随系统；用户手动切换后不再自动跟随
- 切换无闪烁，状态与 DOM 始终一致

### 国际化

- 文案集中在 `src/lib/i18n.resource.ts`，新增文案改一处即可
- 运行时可切换语言，无需重启
- 未命中的 key 会回退为 key 本身，不会崩溃

### 命令系统

命令面板提供两种模式：

- **普通模式** —— 页面跳转、设置打开、重载等常用操作
- **高级模式** —— 输入 `@super` 前缀后执行扩展命令，支持前端动作与 Rust 命令两种执行方式

命令以注册表形式管理，新增命令即插即用。

### 日志

`src/lib/logger.ts` 提供带级别过滤的日志模块：

```ts
import { createLogger } from "@/lib/logger";

const log = createLogger("MyModule");
log.debug("detail", { some: "data" });
log.info("something happened");
log.warn("recoverable problem");
log.error("failed", error);
```

- 输出格式统一为 `[模块:级别]`，带颜色高亮，可按模块检索
- **开发环境**输出全部级别；**生产构建**默认只保留 `warn` / `error`
- 支持子 logger：`log.child("Sub")` → `[MyModule/Sub:info]`

运行时切换级别（无需重新构建），在控制台执行：

```js
localStorage.setItem("app-log-level", "debug"); // 打开全部
localStorage.removeItem("app-log-level");        // 恢复默认
```

---

## 开发约定

### 样式

- **shadcn 组件的样式覆盖请平铺写进 `className`**，由组件内的 `cn()`（`twMerge`）自动合并
- `@layer components` 只用于纯自有元素；该层优先级低于 Tailwind 工具类，覆盖 shadcn 组件会静默失效
- 重复出现 3 次以上的样式组合可收纳为组件类，统一维护在 `App.css`

### shadcn 组件

`src/components/ui/` 由 shadcn CLI 生成，请勿手动修改 —— 会被 `shadcn add/update` 覆盖。全局定制请改 `App.css` 中的设计令牌。

### 权限

Tauri 采用权限白名单机制。新增原生能力时，在 `src-tauri/capabilities/default.json` 中显式声明后前端才能调用。

---

## 许可

[MIT](LICENSE)
