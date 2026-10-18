import { useState } from "react";
import { BookOpen, ChevronRight, FileText, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/composables";
import { useOutline } from "@/contexts/outline";
import type { OutlineNode } from "@/shared/schema";

export interface OutlinePaneProps {
  /** 新建章节：创建后自动打开。 */
  onCreateChapter: (title: string, parentVolumeId: string | null) => Promise<void>;
  /** 新建卷。 */
  onCreateVolume: (title: string) => Promise<void>;
}

/**
 * 左侧结构树：卷分组 + 章列表。
 *
 * 计划书 M2 / M9：层级为作品 > 卷 > 章 > 场景，
 * 左栏承载结构树并常驻当前位置指示。
 */
export default function OutlinePane({
  onCreateChapter,
  onCreateVolume,
}: OutlinePaneProps) {
  const { t } = useI18n();
  const { chapters, volumes, currentChapterId, setCurrentChapterId } = useOutline();

  const [addingVolume, setAddingVolume] = useState(false);
  const [volumeName, setVolumeName] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** 记录"正在给哪个卷添加章"，null 表示添加到根。 */
  const [addingChapterIn, setAddingChapterIn] = useState<string | null | undefined>(undefined);
  const [chapterName, setChapterName] = useState("");

  async function commitVolume() {
    const name = volumeName.trim();
    if (!name) {
      setAddingVolume(false);
      return;
    }
    await onCreateVolume(name);
    setVolumeName("");
    setAddingVolume(false);
  }

  async function commitChapter(parentId: string | null) {
    const title = chapterName.trim();
    if (!title) {
      setAddingChapterIn(undefined);
      return;
    }
    await onCreateChapter(title, parentId);
    setChapterName("");
    setAddingChapterIn(undefined);
  }

  /** 章节按 parentId 归到卷下；parentId 为 null 的归到根。 */
  const chaptersByVolume = new Map<string | null, OutlineNode[]>();
  for (const c of chapters) {
    const key = c.parentId;
    const list = chaptersByVolume.get(key) ?? [];
    list.push(c);
    chaptersByVolume.set(key, list);
  }
  for (const list of chaptersByVolume.values()) list.sort((a, b) => a.order - b.order);

  function renderChapterList(parentId: string | null) {
    const list = chaptersByVolume.get(parentId) ?? [];
    if (!list.length) return null;
    return (
      <ul className="flex flex-col">
        {list.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => setCurrentChapterId(node.id)}
              className={[
                "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors",
                "pl-8 hover:bg-accent hover:text-accent-foreground",
                currentChapterId === node.id
                  ? "bg-accent/60 font-medium text-accent-foreground"
                  : "text-muted-foreground",
              ].join(" ")}
            >
              <FileText className="icon-sm shrink-0" />
              <span className="truncate">{node.title}</span>
              {node.synopsis ? (
                <span className="ml-auto max-w-[40%] truncate text-xs text-muted-foreground/60">
                  {node.synopsis}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 标题栏 */}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <h2 className="row-label">{t("Editor.side.outline")}</h2>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => {
              setChapterName("");
              setAddingChapterIn(null);
            }}
            aria-label={t("Editor.side.addChapter")}
            title={t("Editor.side.addChapter")}
          >
            <Plus className="icon-sm" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => {
              setVolumeName("");
              setAddingVolume(true);
            }}
            aria-label={t("Editor.side.addVolume")}
            title={t("Editor.side.addVolume")}
          >
            <BookOpen className="icon-sm" />
          </Button>
        </div>
      </div>

      {/* 树体 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {/* 添加卷输入框 */}
        {addingVolume ? (
          <div className="mb-1 flex items-center gap-1 px-1">
            <Input
              autoFocus
              value={volumeName}
              placeholder={t("Editor.side.volume")}
              className="h-7 text-sm"
              onChange={(e) => setVolumeName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) void commitVolume();
                if (e.key === "Escape") setAddingVolume(false);
              }}
            />
          </div>
        ) : null}

        {/* 卷分组 */}
        {volumes.map((volume) => {
          const isCollapsed = collapsed[volume.id];
          return (
            <div key={volume.id} className="mb-1">
              <div className="group flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent/40">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((prev) => ({ ...prev, [volume.id]: !prev[volume.id] }))
                  }
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <ChevronRight
                    className={[
                      "icon-sm shrink-0 text-muted-foreground transition-transform",
                      isCollapsed ? "" : "rotate-90",
                    ].join(" ")}
                  />
                  <BookOpen className="icon-sm shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{volume.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground/60">
                    {(chaptersByVolume.get(volume.id) ?? []).length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChapterName("");
                    setAddingChapterIn(volume.id);
                  }}
                  className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-accent-foreground"
                  aria-label={t("Editor.side.addChapter")}
                >
                  <Plus className="icon-sm" />
                </button>
              </div>

              {!isCollapsed ? (
                <>
                  {addingChapterIn === volume.id ? (
                    <div className="flex items-center gap-1 py-1 pl-6 pr-2">
                      <Input
                        autoFocus
                        value={chapterName}
                        placeholder={t("Editor.side.chapter")}
                        className="h-7 text-sm"
                        onChange={(e) => setChapterName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.nativeEvent.isComposing)
                            void commitChapter(volume.id);
                          if (e.key === "Escape") setAddingChapterIn(undefined);
                        }}
                      />
                    </div>
                  ) : null}
                  {renderChapterList(volume.id)}
                </>
              ) : null}
            </div>
          );
        })}

        {/* 根层章节（不属于任何卷）*/}
        {addingChapterIn === null ? (
          <div className="flex items-center gap-1 py-1 pl-2 pr-2">
            <Input
              autoFocus
              value={chapterName}
              placeholder={t("Editor.side.chapter")}
              className="h-7 text-sm"
              onChange={(e) => setChapterName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) void commitChapter(null);
                if (e.key === "Escape") setAddingChapterIn(undefined);
              }}
            />
          </div>
        ) : null}
        {renderChapterList(null)}

        {!volumes.length && !chapters.length && addingVolume === false && addingChapterIn === undefined ? (
          <div className="px-2 py-6 text-center">
            <p className="text-xs text-muted-foreground">{t("Editor.side.emptyWork")}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
