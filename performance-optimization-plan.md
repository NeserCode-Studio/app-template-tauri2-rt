# 前端性能优化与工程化改造计划

> 目标：在不破坏现有功能的前提下，优化 `app-template`（Tauri 2 + React 19 + Vite 6 + Tailwind 4 + shadcn/ui）的性能与工程结构。重点是前端运行时性能、框架范式规范化，以及抽离/解耦/封装。
>
> 每个步骤都标注 **为什么**、**怎么做**、**值不值得**（含明确的"不值得"项）。

---

## 0. 现状诊断结论（先看这个）

技术栈：React 19 + React Router 7 + Vite 6（SWC）+ Tailwind CSS 4 + shadcn/ui（new-york）+ Tauri 2。

读完整个 `src/` 后，真正的性能/工程问题集中在 5 处，其余都是锦上添花：

| # | 问题 | 类型 | 严重度 |
|---|------|------|--------|
| 1 | `App.tsx` 三个 Context 的 `value` 全是内联对象，任一状态变化 → 所有消费者全量重渲染 | 运行时性能 | 高 |
| 2 | `useTheme` 的 `setTheme` 用 `classList.toggle("dark")` 缺 force 参数 + 初始状态与 DOM 不同步 | 正确性 bug | 高 |
| 3 | `App.tsx` 是 125 行"上帝文件"，Context 定义与使用反向依赖（子组件 `import { ThemeContext } from "@/App"`） | 架构/解耦 | 中 |
| 4 | `sonner` 被使用 → 顺带把 Next.js 专用的 `next-themes` 打进生产包；另有 10+ 个死依赖 | 包体积 | 中 |
| 5 | 两套图标库并存（`@heroicons/react` + `lucide-react`）；`pnpm`/`yarn` 混用；无 ESLint/Prettier | 规范化 | 中 |
| 6 | 生命周期逻辑散落在 `main.tsx`/`App.tsx`/`useTheme`/`useI18n`/`TrayMenu`/`TitlebarOperations` 等 6+ 文件，无统一入口、无扩展点、易漏事件清理 | 架构/扩展性 | 中 |

**重要澄清（避免走弯路）**：项目里有 59 个 shadcn UI 组件文件，但实际只用到 11 个（`sonner/scroll-area/select/checkbox/label/button/input/command/dialog/menubar/separator/tooltip`）。**未使用的组件文件不会进入生产包**——Vite/Rollup 会 tree-shaking。所以"删掉没用到的 48 个 UI 文件来减小包体"是伪需求，详见第 5 节"不值得做的事"。

---

## 0.1 度量基线（动手前必须先做）

**为什么**：没有基线的优化是猜测。当前所有结论来自代码审阅，不是测量。改完需要数字证明有效。

**怎么做**：
1. 加 `rollup-plugin-visualizer`（仅 `--mode analyze` 时启用），跑 `pnpm build` 看当前 chunk 大小与依赖占比。
2. React DevTools Profiler 录制一次"启动 → 切主题 → 切语言 → 开命令面板"，记录渲染耗时与渲染次数。
3. 记录 `tsc --noEmit` 耗时（当前 `build` 会先跑全量类型检查）。

**值不值得**：值得。这是 10 分钟的事，却能让后续每一步"有效/无效"可判断。

---

## 1. P0 — 必做（明确收益、低风险、先做）

### 1.1 修复 Context 内联 `value` 导致的全局重渲染

**为什么**：`App.tsx` 中四个 Provider 的 `value` 都是每次 render 新建的对象字面量：

```tsx
<I18nContext.Provider  value={{ lang, t, setLang: setLanguage }}>  // 每次 render 新对象
  <ThemeContext.Provider value={{ theme, setThemeMode }}>
    <TitleContext.Provider value={{ title, setTitle }}>
      <NavigatorContext.Provider value={{ navigator: navigate }}>
```

React 判断 Context 是否变化用的是 `Object.is` 引用比较。对象每次都是新引用 → 只要 `App` 重渲染（切主题、切语言、改标题、路由跳转都会触发），**所有消费这四个 Context 的组件全部无条件重渲染**，包括被 `memo` 包裹的 `TitlebarTitle` 和 `Tooltip`（memo 被引用变化直接击穿，等于白写）。

**怎么做**：用 `useMemo`/`useCallback` 固定 value 引用，或直接把每个 Provider 拆成独立组件（子组件用 `children` 保持稳定）。推荐后者——拆 Provider 天然解耦，也为 1.3 打基础。最小改法是：

```tsx
const i18nValue = useMemo(() => ({ lang, t, setLang: setLanguage }), [lang, t, setLanguage]);
const themeValue = useMemo(() => ({ theme, setThemeMode }), [theme, setThemeMode]);
```

同时把 `useI18nLogic` 的 `t` 用 `useCallback` 包起来（`t` 依赖 `lang`），否则 `t` 每次 render 都是新函数，i18nValue 的 memo 会失效。

**值不值得**：值得，且是本次优化里**收益最高的一项**。当前这个模板页面少、交互轻，绝对帧率影响看不太出来，但这是"地基级"范式错误——模板会被复制去写真实业务，错误会被放大。修起来 20 分钟，零风险。

---

### 1.2 修复 `useTheme` 的主题切换 bug

**为什么**：`useTheme.ts` 有两个真 bug，不是风格问题：

1. `setTheme` 里写的是 `document.querySelector("html")?.classList.toggle("dark")`——**没有传第二个参数 `force`**。`toggle` 依据当前 DOM 状态翻转，而不是按目标主题设置。结果：`themeState` 与 DOM class 会错位。例如超级命令里 `theme.light` 在"已是浅色"时执行，会把 `dark` 类**加上**，出现反色闪烁。
2. 初始状态与 DOM 不同步：`useState` 默认是 `localTheme ?? "light"`，而 `useEffect` 里 initialTheme 可能因为系统 `prefers-color-scheme: dark` 被设成 `"dark"` 并加到 DOM，但 state 仍是 `"light"`。首次渲染主题就是错位的。

**怎么做**：
- 改为 `classList.toggle("dark", theme === "dark")`（显式 force）。
- 初始状态直接从 `matchMedia` + localStorage 计算出来，放进 `useState` 的初始化器里，而不是 `useEffect` 里二次修正。
- 顺带删掉 `useEffect` 里重复读 `localStorage.getItem`（初始化器已经读过了）。

**值不值得**：值得。这是**正确性 bug**，会直接造成用户可见的主题错乱/闪烁，优先级甚至高于 1.1。修起来 10 分钟。

---

### 1.3 拆分 `App.tsx`，Context 抽离到独立模块（解耦 + 封装）

**为什么**：`App.tsx` 同时干了 5 件事：定义 3 个 Context、路由、i18n 逻辑、主题逻辑、托盘事件监听。更糟的是，Context 定义在 `App.tsx` 里，子组件反向 `import { ThemeContext } from "@/App"`，形成 `App → Titlebar → App` 的**循环依赖**。这既难读、难测，也让 1.1 的 Provider 拆分做不干净。

**怎么做**：
1. 新建 `src/contexts/`（或 `src/providers/`），把 `ThemeContext`、`NavigatorContext`、`TitleContext`、`I18nContext` 各自挪到独立文件，每个文件导出 Context + 对应 Provider + `useXxx()` hook。
2. `App.tsx` 退化成纯粹的"组合 Provider + 路由 + 布局"入口。
3. 子组件改从 `@/contexts/theme` 等导入，删除对 `@/App` 的反向 import。
4. 托盘事件监听（`tray-popup`、`navigate`）抽成一个 `useTrayEvents()` hook。

**值不值得**：值得。它不直接"提速"，但它是 1.1 能彻底落地的前提，也是"抽离/解耦/封装"这条主线的核心交付。对模板而言，清晰的分层比省几十毫秒更重要。工作量中等（约 1~2 小时），建议和 1.1 一起做，避免返工。

---

## 2. P1 — 建议做（收益中等、工程量小）

### 2.1 清理死依赖（**暂缓**）

> 状态：**暂缓执行**。为什么暂缓、以及何时重新启用，见下方"值不值得"。

**为什么**（保留分析，供将来启用时参考）：这是唯一一个"包体积"维度有真实收益的项，但很多人理解错方向。事实是：

- **`sonner.tsx` 被使用**，而它内部 `import { useTheme } from "next-themes"` → `next-themes`（一个 Next.js 专用主题库）**真的被打进了生产包**，纯属浪费。
- 下面这些依赖**在 `package.json` 里、但没有任何可达引用**，属于死依赖：`@tanstack/react-table`、`@hookform/resolvers`、`react-hook-form`、`zod`、`react-day-picker`、`date-fns`、`embla-carousel-react`、`recharts`、`vaul`、`input-otp`、`react-resizable-panels`、`react-transition-group`。（它们对应的 UI 文件 `form/calendar/carousel/chart/drawer/input-otp/resizable` 都未被引用，所以它们只增加 `node_modules` 体积和安装时间，**不增加生产包**。）

**怎么做**（将来启用时执行）：
1. `next-themes`：改 `sonner.tsx`，去掉 `useTheme` 导入（这个模板的主题状态在 `ThemeContext`，sonner 的 `theme` prop 已经由 `App.tsx` 显式传入，根本不需要 next-themes 读系统主题）。删依赖。
2. 死依赖：从 `package.json` 移除上表全部 12 个包，重装。UI 源文件保留（见第 5 节），等未来真正用到某个组件时再 `shadcn add` / 手动装回对应依赖即可——这是模板的正确玩法，不是"删功能"。

**值不值得**：**暂缓，分两层看，别一刀切。**

1. **真正进生产包的只有 `next-themes` 一个**（几 KB）。其余 12 个死依赖只占 `node_modules` 体积和安装时间，**对运行性能零影响**。
2. **作为模板，保留这些依赖有实际价值**：`recharts`/`react-hook-form`/`zod`/`react-day-picker` 是用户拿到模板后高频会用的，现在删掉，未来要用还得再装回，反而打断开发节奏。
3. **唯一建议保留的例外**：`next-themes` 是 Next.js 专用库，被误打进生产包纯属污染。若后续做"统一图标库（2.2）"时顺手动了 `sonner.tsx`，可一并摘掉；否则不单独为它开一次改动。

**重新启用条件**：当模板确定要长期瘦身、或团队明确不再依赖这些 UI 组件时，再按上面"怎么做"执行。

---

### 2.2 统一图标库（二选一）

**为什么**：现在 `TitlebarOperations.tsx` 用 `@heroicons/react`，其余用 `lucide-react`。两套图标库意味着两份样式、两套心智模型，还可能重复打包相近图标。这属于"规范化"范畴。

**怎么做**：全项目统一到 `lucide-react`（shadcn 默认、tree-shaking 好、图标更全）。`TitlebarOperations` 里 4 个 heroicons 图标（`Minus/XMark/Sun/Moon/PaperClip`）在 lucide 里都有对应（`Minus/X/Sun/Moon/Paperclip`）。改完删 `@heroicons/react` 依赖。

**值不值得**：值得，但优先级排在 1.x 之后。纯一致性收益，无性能硬伤（两个库都会 tree-shake）。半小时。

---

### 2.3 规范化：补 ESLint + Prettier + 脚本

**为什么**：项目只有 `tsconfig`，没有任何 lint/format。模板没有规范约束，后续任何人的提交都会长出各种风格。这是"规范化"要求里最基础、性价比最高的一项。

**怎么做**：
1. 加 ESLint（`eslint` + `typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh`），Prettier + `prettier-plugin-tailwindcss`。
2. `package.json` 加 `"lint": "eslint ."`、`"format": "prettier --write ."`。
3. 跑一遍修复，把现有代码格式化到统一风格（注意：这会全量 diff，建议单独一个 commit）。

**值不值得**：值得。零风险、标准动作，且能顺带揪出 `noUnusedLocals` 抓不到的隐患（如 `any` 类型、未处理的 promise）。半天。

---

### 2.4 统一包管理器（pnpm）

**为什么**：`package.json` 有 `pnpm.onlyBuiltDependencies` 字段（说明用 pnpm），但仓库里**同时存在** `pnpm-lock.yaml` 和 `yarn.lock`，且 `tauri.conf.json` 的 `beforeDevCommand/beforeBuildCommand` 写的是 `yarn dev` / `yarn build`。三处矛盾，谁 clone 下来跑谁炸。

**怎么做**：定 pnpm。删除 `yarn.lock`，把 `tauri.conf.json` 两个命令改成 `pnpm dev` / `pnpm build`。

**值不值得**：值得。这不是性能项，但属于"规范化"硬伤，且是 1 分钟的事。

---

### 2.5 `TrayMenu` 懒加载

**为什么**：`App.tsx` 第 16 行 `import TrayMenu from "@/views/TrayMenu"` 是**同步**导入，但 `TrayMenu` 只在托盘窗口（label === "tray"）里用。主窗口用户永远用不到它，却为它加载了 `@tauri-apps/api/window` 等代码。主窗口 4 个页面都做了 `lazy`，唯独托盘没做，是不一致。

**怎么做**：改成 `const TrayMenu = lazy(() => import("@/views/TrayMenu"))`，托盘分支里用 `<Suspense>` 包住。

**值不值得**：值得做，但收益小（托盘菜单本身很轻）。10 分钟，顺手做掉，和 2.6 一起。

---

### 2.6 清理死代码与 Next.js 残留

**为什么**：下列都是"没用但占地方"的代码，属于模板卫生问题：
- `src/lib/tray.ts`（`AppTray`、`LocalTrayIds`）：定义完整但**全项目零引用**（托盘逻辑实际在 `TrayMenu.tsx` 里）。
- `composables/index.ts` 里的 `nextTick`：只是 `queueMicrotask` 的别名，唯一用途在 `main.tsx`。
- `CommandDialog.tsx` 顶部的 `"use client"`：Next.js 的 RSC 指令，在 Vite 里是死字符串。
- `useSuperCommand` 的 `confirm`/`confirmMessage` 字段：定义了但 `CommandDialog` 从未消费。

**怎么做**：删 `tray.ts`（确认后端无引用后）；`main.tsx` 直接用 `queueMicrotask` 并删 `nextTick`；删 `"use client"`；`confirm` 字段要么实现要么移除（建议移除，YAGNI）。

**值不值得**：值得，但单项都是"顺手"。合并成一次清理 commit，20 分钟。

---

### 2.7 生命周期钩子系统（新增需求）

**为什么**：当前"生命周期"相关的逻辑散落在至少 6 个文件里，各管各的，没有统一入口，也没有扩展点：

| 阶段 | 当前实现位置 | 形式 |
|------|-------------|------|
| 启动引导（渲染前） | `main.tsx` | `nextTick(() => $windowMain.renderFocus())` |
| 挂载后（事件注册） | `App.tsx` | `useEffect` 里 `listen("tray-popup")` / `listen("navigate")` |
| 主题初始化 | `useTheme.ts` | `useEffect` + `matchMedia` 监听 |
| 语言初始化 | `useI18n.ts` | `useState` 初始化器读 localStorage |
| 窗口置顶同步 | `TitlebarOperations.tsx` | `useEffect` 里 `setAlwaysOnTop` |
| 托盘窗口准备 | `TrayMenu.tsx` | `useEffect` 里 hide/setSize/blur 监听 |
| 退出清理 | 后端 `AppTray.quit`（死代码）+ `WindowUtils.windowsQuit` | 无统一退出钩子 |

后果：想加一个生命周期动作（如"启动时检查更新""退出前保存状态""聚焦时刷新数据"）没有统一挂载点，只能到处塞 `useEffect`，难追踪、易漏事件清理、不可测试。这就是本需求要解决的。

**设计目标**：
1. **统一入口**：所有阶段集中在一个注册中心，可读、可测、可插拔。
2. **可扩展**：新增阶段只扩一个枚举值；新增钩子一行 `register(...)` 即可，第三方模块也能注册。
3. **性能友好**：注册零成本、惰性执行、稳定引用（呼应 1.1）、按阶段控制顺序/并发、可清理防泄漏。

**接口设计**（复用 `useSuperCommand` 的"注册表"范式，团队心智一致）：

```ts
// src/lifecycle/types.ts
export type LifecycleStage =
  | "bootstrap"      // 应用引导：React 挂载前执行一次
  | "mount"          // React 已挂载、DOM 可用
  | "ready"          // 主窗口已显示并聚焦，应用可交互
  | "theme-init"     // 主题初始化完成
  | "theme-change"   // 主题切换后
  | "i18n-init"      // 语言初始化完成
  | "lang-change"    // 语言切换后
  | "window-show" | "window-hide" | "window-focus" | "window-blur"
  | "before-quit";   // 退出前清理（支持异步）

export interface LifecycleHook {
  id: string;              // 唯一 id，用于 unregister
  stage: LifecycleStage;
  run: (ctx: LifecycleContext) => void | Promise<void>;
  once?: boolean;          // 默认 false；bootstrap/mount/ready/init 类通常 true
  priority?: number;       // 同阶段执行顺序，越小越先，默认 0
}

export interface LifecycleContext {
  stage: LifecycleStage;
  // 按需扩展：window、app、payload 等
}
```

```ts
// src/lifecycle/bus.ts —— 模块级单例，不在 React render 期创建
class LifecycleBus {
  private hooks = new Map<LifecycleStage, LifecycleHook[]>();
  private fired = new Set<LifecycleStage>();   // 记录 once 阶段已触发，保证幂等

  register(hook: LifecycleHook): () => void {  // 返回卸载函数
    const list = [...(this.hooks.get(hook.stage) ?? []), hook];
    list.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    this.hooks.set(hook.stage, list);
    return () => this.unregister(hook.id);
  }

  unregister(id: string) {
    for (const [stage, list] of this.hooks) {
      this.hooks.set(stage, list.filter((h) => h.id !== id));
    }
  }

  async fire(stage: LifecycleStage, ctx: LifecycleContext) {
    if (this.fired.has(stage)) return;         // 幂等：once 阶段只跑一次
    this.fired.add(stage);
    for (const hook of [...(this.hooks.get(stage) ?? [])]) {
      await hook.run(ctx);                     // 默认顺序 await，顺序可预测
      if (hook.once) this.unregister(hook.id);
    }
  }
}

export const lifecycle = new LifecycleBus();
```

**与现有模块的对接（解耦：编排 vs 能力分离）**——关键原则：`WindowUtils`/`useTheme`/`useI18n` 这些"能力层"保持原样，生命周期总线只做**编排**，不重复实现能力：

| 现有逻辑 | 迁移方式 |
|---------|---------|
| `main.tsx` 的 `nextTick(renderFocus)` | `lifecycle.register({ id: "window.focus-on-ready", stage: "bootstrap", once: true, run: () => $windowMain.renderFocus() })` |
| `App.tsx` 的 `tray-popup`/`navigate` 监听 | 收敛到 `useTrayEvents()`（见 1.3），`mount` 阶段 `listen`，`before-quit` 阶段统一 `unlisten` |
| `useTheme` 初始化 | `theme-init` 触发，`theme-change` 广播切换 |
| `useI18n` 初始化 | `i18n-init` / `lang-change` |
| `TitlebarOperations` 的 `setAlwaysOnTop` | `window-show` 阶段同步 |
| `TrayMenu` 的准备逻辑 | 托盘窗口 `window-show` 阶段 |
| 退出清理 | 所有清理钩子挂 `before-quit`，`WindowUtils.windowsQuit` 作为最后一个钩子 |

React 侧用一个薄 hook 把总线接到组件生命周期，避免组件直接 import 单例导致测试困难：

```ts
// src/lifecycle/useLifecycle.ts
export function useLifecycle(stage: LifecycleStage, run: LifecycleHook["run"], deps: unknown[]) {
  useEffect(() => lifecycle.register({ id: `${stage}:${useId()}`, stage, run }), deps);
  // register 返回的卸载函数作为 effect 清理，组件卸载自动移除
}
```

**性能考量**（逐条明确）：
1. **模块级单例，脱离 React 渲染**：`lifecycle` 是模块顶层常量，注册/触发都不触发 React 重渲染。绝不要把总线放进 Context——否则又会踩 1.1 那种引用抖动。
2. **注册零成本**：`register` 只是数组 push + sort，不在渲染热路径。
3. **惰性执行**：钩子只在对应 stage 触发时才执行，未触发的阶段零开销。
4. **稳定引用**：`fire`/`register`/`unregister` 都是模块级方法；`useLifecycle` 用 effect 的清理函数卸载，不在 render 期建新闭包。
5. **顺序 vs 并发**：默认顺序 `await`（可预测、易排查）；对真正独立的阶段可加 `parallel: true` 用 `Promise.all`。不要为了并发而并发。
6. **幂等 + 可清理**：`once` 阶段用 `fired` 集合保证只跑一次；`register` 返回卸载函数，杜绝事件监听泄漏。
7. **避免 hot path 重活**：`window-focus`/`theme-change` 这类可能高频触发的阶段，文档要求钩子必须轻量，禁止在钩子里做同步大计算或连锁 `setState`。

**扩展方式**：
- **新增阶段**：在 `LifecycleStage` 联合类型加一个字符串即可，`fire` 无需改动。
- **新增钩子**：任意模块 `lifecycle.register({ id, stage, run })`，零侵入。
- **预留后端事件**：Rust 侧 `RunEvent`（`ExitRequested`/`Exit`）可映射为 `before-quit`；`tray-popup` 等 `emit` 事件可映射为自定义 stage，接口不需要预留特殊分支。

**值不值得**：值得，但要分清收益性质——**它不直接"提速"，收益是"结构清晰 + 可扩展 + 可测试"**，属于"抽离/解耦/封装"主线，不是性能主线。当前模板规模小，散落的 `useEffect` 也能跑；但模板会被复制去写真实业务，业务生命周期（启动检查更新、退出前保存、聚焦刷新）会成倍增长，届时没有统一挂载点会很难收拾。建议在 1.3 拆完 Context 之后做（复用拆出的模块边界），工作量约 1 小时。

**不要过度设计**：不需要钩子依赖图/DAG、不需要热重载、不需要嵌套阶段。`register` + `fire` + `once` + `priority` 四个原语足够，再加就是负担。

---

## 3. P2 — 可选（收益小，或需要权衡）

### 3.1 Vite 手动分包（manualChunks）

**为什么**：当前没配 `build.rollupOptions.output.manualChunks`，React/Vendor 全打一个大 chunk。一旦模板用户引入 `recharts`（约 400KB）这类重库，主 chunk 会膨胀，首屏加载变慢。

**怎么做**：在 `vite.config.ts` 配 `manualChunks`，把 `react/react-dom/react-router`、`@radix-ui/*`、`recharts` 等拆成独立 vendor chunk，让缓存命中更稳。

**值不值得**：**当前不值得**（现在没有重库，拆了收益为零）。但作为模板的"预防性配置"可以留一个注释/开关，等真的上图表再启用。建议只写进计划，不立即做。

### 3.2 目录语义修正（`composables` → `hooks`）

**为什么**：`src/composables/` 是 Vue 生态的叫法，里面放的是 `useTheme/useI18n/useToast` 这些 React hooks。命名与实际不符，新人会困惑。

**怎么做**：重命名目录为 `src/hooks/`，同步改所有 import（`@/composables` → `@/hooks`）。`useSuperCommand` 若想留"命令注册表"语义，可归入 `src/features/super-command/`。

**值不值得**：中低。纯命名，不影响运行，但影响"规范化"的观感。可以在 1.3 抽离时一并做，避免单独一次全量 import 改动。

### 3.3 用 React 19 新特性收敛状态（可选）

**为什么**：项目已上 React 19，但很多地方还是 18 的写法。例如 `useLocalStorageState`（ahooks）在 `App.tsx`/`Settings.tsx`/`TitlebarOperations.tsx` 三处各写一遍，可封装一个 `usePersistentState` 统一持久化语义。

**怎么做**：封装统一 hook；主题/标题/自动补全/置顶都走它。属于"封装"主线的延伸。

**值不值得**：中低。收益是减少重复、统一行为，但当前三处已经能用，属于"锦上添花"。留给 1.x/2.x 之后有余力再做。

### 3.4 后端（Rust/Tauri）release 优化

**为什么**：用户说重点是前端，但"整个项目"也含 Tauri 后端。当前 `Cargo.toml` 没有 `[profile.release]` 配置，产物体积与运行时都有优化空间。

**怎么做**：加 `lto = true`、`strip = true`、`codegen-units = 1`、`opt-level = "s"`；把 `devtools` feature 移到 `[dev-dependencies]`（生产不需要 devtools）；补 `security.csp`（当前为 `null`，属安全非性能）。

**值不值得**：值得，但**不在本次"前端性能"主线内**，单独列一条，建议作为后续独立任务。CSP 是安全项，顺手提醒，不混入性能计划。

---

## 4. 建议执行顺序

1. **0.1 度量基线**（10 分钟）→ 拿到数字。
2. **1.2 修 useTheme bug**（10 分钟，独立、紧急）。
3. **1.3 + 1.1 一起做**：拆 Context + 固定 value 引用（1.5~2 小时，核心）。
4. **2.7 生命周期钩子系统**（约 1 小时，紧接 1.3，复用拆出的模块边界）。
5. **2.4 统一 pnpm** + **2.6 死代码清理** + **2.5 TrayMenu 懒加载**（合并一次，半小时）。
6. **2.2 统一图标** + **2.3 ESLint/Prettier**（半天，规范化收尾）。
7. **3.x 按需**（含 2.1 死依赖，暂缓）。
8. 回跑 0.1 的度量，对比渲染次数 / 包体积 / `tsc` 耗时。

---

## 5. 明确"不值得做"的事（避免浪费）

1. **删除未使用的 48 个 shadcn 组件文件来"减包"**：不值得。它们已被 tree-shaking，不进生产包；而且这是模板，这些组件正是模板的价值。真正该做的是删掉它们背后的**死 npm 依赖**（2.1），组件文件保留。
2. **引入状态管理库（Zustand/Jotai/Redux）**：不值得。当前 4 个页面、几个局部状态，Context 完全够用。加状态库是负资产。
3. **上虚拟化列表（react-window 等）**：不值得。没有任何长列表。
4. **到处 `React.memo` / `useCallback`**：不值得。先用 1.1 修好 Context 引用，让已有的 `memo` 生效；无脑 memo 是过早优化，反而增加维护成本。
5. **把 `oklch` 颜色换成 hex、把 `@apply` 嵌套摊平**：不值得。Tailwind 4 构建期已经编译成静态 CSS，这些不影响运行时。
6. **生命周期钩子做成 DAG/依赖图/热重载/嵌套阶段**：不值得。`register` + `fire` + `once` + `priority` 已覆盖当前需求，过度设计是纯负担。

---

## 附：验收标准

- 切主题/切语言/改标题时，React DevTools Profiler 显示"非相关组件"不再重渲染（如改标题时 `TitlebarOperations` 不渲染）。
- 生命周期钩子：`lifecycle.fire("ready")` 按 `priority` 顺序执行；新增一个自定义 stage 无需改总线；组件卸载后钩子自动移除（无事件监听泄漏）。
- 生产包中无 `next-themes`（若 2.1 重新启用）。
- `pnpm build` 的 chunk 里无 `recharts/react-day-picker/vaul/input-otp` 等死依赖（若 2.1 重新启用）。
- `tauri.conf.json` 与 lockfile 只剩一套包管理器。
- 全项目 `pnpm lint` 零 error，格式化一致。
