/**
 * SearchContext：全站搜索的索引与结果。
 *
 * 索引的生命周期跟着工作区与当前作品走：作品结构树变化时重建章条目，
 * 素材条目变化时替换 codex 段。正文按需读，不预载。
 */

import { createContext, useContext } from "react";
import type { SearchHit } from "@/services/search";

export interface SearchContextValue {
  /** 执行搜索；query 为空时返回空数组。 */
  search: (query: string) => Promise<SearchHit[]>;
}

export const SearchContext = createContext<SearchContextValue>({
  search: async () => [],
});

export function useSearch(): SearchContextValue {
  return useContext(SearchContext);
}
