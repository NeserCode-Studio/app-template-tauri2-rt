/**
 * fs 桥封装：所有磁盘读写都经过这里，services 不直接碰 invoke。
 *
 * 约定：
 * - root 是工作区根的绝对路径（由 workspace 模块维护）。
 * - rel 是相对工作区的相对路径，一律用 "/" 分隔。
 * - 读写 JSON 时自动序列化 / 反序列化，并约定 UTF-8 无 BOM。
 */

import { invoke } from "@tauri-apps/api/core";

export interface FsBridge {
  readText(rel: string): Promise<string>;
  writeText(rel: string, content: string): Promise<void>;
  readDir(rel: string): Promise<string[]>;
  createDir(rel: string): Promise<void>;
  remove(rel: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  exists(rel: string): Promise<boolean>;
  stat(rel: string): Promise<{ isDir: boolean; size: number; modified: number }>;
}

/** 以工作区根为作用域创建一组 fs 操作。 */
export function createFs(root: string): FsBridge {
  const call = (cmd: string, args: Record<string, unknown>) =>
    invoke(cmd, { root, ...args }) as Promise<unknown>;

  return {
    readText: (rel) => call("fs_read_text", { rel }) as Promise<string>,
    writeText: (rel, content) =>
      call("fs_write_text", { rel, content }) as Promise<void>,
    readDir: (rel) => call("fs_read_dir", { rel }) as Promise<string[]>,
    createDir: (rel) => call("fs_create_dir", { rel }) as Promise<void>,
    remove: (rel) => call("fs_remove", { rel }) as Promise<void>,
    rename: (from, to) => call("fs_rename", { from, to }) as Promise<void>,
    exists: (rel) => call("fs_exists", { rel }) as Promise<boolean>,
    stat: (rel) =>
      call("fs_stat", { rel }) as Promise<{
        isDir: boolean;
        size: number;
        modified: number;
      }>,
  };
}

/** 把相对路径片段用 "/" 拼接（前端统一用正斜杠）。 */
export function joinRel(...parts: string[]): string {
  return parts
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .trim();
}
