import { useEffect } from "react";
import type { LifecycleHook, LifecycleStage } from "./types";
import { lifecycle } from "./bus";

/**
 * 声明式注册一个生命周期钩子。
 *
 * 组件挂载时注册、卸载时自动移除（register 返回的卸载函数作为 effect 清理）。
 * `run` 依赖的响应式值变化时，通过 `deps` 触发重新注册。
 *
 * 示例：组件想在应用退出前保存状态
 *   useLifecycle("before-quit", () => saveState(), [saveState]);
 */
export function useLifecycle(
  stage: LifecycleStage,
  run: LifecycleHook["run"],
  deps: unknown[] = []
): void {
  useEffect(() => {
    const hook: LifecycleHook = {
      id: `${stage}:${Math.random().toString(36).slice(2)}`,
      stage,
      run,
    };
    return lifecycle.register(hook);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
