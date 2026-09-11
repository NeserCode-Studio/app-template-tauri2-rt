/**
 * 软件生命周期阶段定义。
 *
 * 扩展方式：新增一个阶段只需在 LifecycleStage 联合类型里加一个字符串，
 * fire/register 无需任何改动；对应钩子的触发时机由调用方（fire 处）决定。
 *
 * 约定：
 * - 一次性阶段（bootstrap / mount / ready / *-init / before-quit）的钩子应设 once: true；
 * - 高频阶段（theme-change / window-focus / window-blur / window-show / window-hide）
 *   的钩子必须轻量，禁止在钩子里做同步大计算或连锁 setState。
 */

export type LifecycleStage =
  /** 应用引导：模块加载、React 渲染前触发一次。适合放与渲染无关的纯前端初始化（如预加载静态资源）。 */
  | "bootstrap"
  /** React 挂载完成：App 首次挂载后触发一次。适合注册全局事件监听、启动定时任务。 */
  | "mount"
  /** 应用就绪：主窗口已显示并聚焦、可交互。适合放需要窗口就绪后才能执行的动作（如聚焦、请求注意力）。 */
  | "ready"
  /** 主题初始化完成：首次确定 light/dark 后触发一次。 */
  | "theme-init"
  /** 主题切换：每次用户或系统切换主题后触发（高频，钩子必须轻量）。 */
  | "theme-change"
  /** 语言初始化完成：首次确定语言后触发一次。 */
  | "i18n-init"
  /** 语言切换：每次切换语言后触发。 */
  | "lang-change"
  /** 窗口显示时触发。 */
  | "window-show"
  /** 窗口隐藏时触发。 */
  | "window-hide"
  /** 窗口获得焦点时触发（高频，钩子必须轻量）。 */
  | "window-focus"
  /** 窗口失去焦点时触发（高频，钩子必须轻量）。 */
  | "window-blur"
  /** 退出前清理：应用退出前触发一次（支持异步）。适合保存状态、释放资源。 */
  | "before-quit";

export interface LifecycleContext {
  stage: LifecycleStage;
  /** 预留：允许 fire 时携带任意上下文字段，例如 { window: "main" } */
  [key: string]: unknown;
}

export interface LifecycleHook {
  /** 唯一 id，用于 unregister */
  id: string;
  stage: LifecycleStage;
  run: (ctx: LifecycleContext) => void | Promise<void>;
  /** 是否只执行一次，执行后自动移除。默认 false */
  once?: boolean;
  /** 同阶段内执行顺序，越小越先执行。默认 0 */
  priority?: number;
}
