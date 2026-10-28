/**
 * 素材库 V2 对外入口。
 *
 * 旧路径 `@/services/codex` 仍然可用——这里把模型、内置模板与存储层
 * 统一导出，调用方不需要知道文件是怎么拆的。
 */

export * from "./types";
export * from "./builtin";
export * from "./store";
export * from "./display";
