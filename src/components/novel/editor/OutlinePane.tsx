import { useState } from "react";
import { BookOpen, ChevronRight, FileText, Plus, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/composables";
import { useOutline } from "@/contexts/outline";
import type { OutlineNode } from "@/shared/schema";

/** 章 / 卷状态：与 schema 的 status 枚举一致。 */
type NodeStatus = "draft" | "revising" | "final";

export interface OutlinePaneProps {
  /** 新建章节：创建后自动打开。 */
  onCreateChapter: (title: string, parentVolumeId: string | null) => Promise<void>;
  /** 新建卷。 */
  onCreateVolume: (title: string) => Promise<void>;
  /** 移动节点（排序 / 升降级）。 */
  onMoveNode: (
    nodeId: string,
    targetParentId: string | null,
    targetIndex: number
  ) => Promise<void>;
  /** 更新节点的章状态与摘要。 */
  onUpdateNode: (
    nodeId: string,
    patch: { status?: "draft" | "revising" | "final"; synopsis?: string }
  ) => Promise<void>;
}

/**
 * 拖放过程中的两种落点。
 *
 * - `over`：插在目标节点之前（同级换位）
 * - `inside`：移进目标节点内部（仅卷可作为容器）
 *
 * 区分二者是升降级的关键：竖直位置偏上=插入其前，偏下=插入其后，
 * 悬停在条目正中=移进它。两个意图不能混在一个手势里。
 */
type DropIntent =
  | { kind: "before" | "after"; parentId: string | null }
  | { kind: "inside"; parentId: string };

interface DragState {
  nodeId: string;
  /** 当前悬停的落点意图。 */
  intent: DropIntent | null;
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
  onMoveNode,
  onUpdateNode,
}: OutlinePaneProps) {
  const { t } = useI18n();
  const { chapters, volumes, currentChapterId, setCurrentChapterId } = useOutline();

  const [addingVolume, setAddingVolume] = useState(false);
  const [volumeName, setVolumeName] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** 记录"正在给哪个卷添加章"，null 表示添加到根。 */
  const [addingChapterIn, setAddingChapterIn] = useState<string | null | undefined>(undefined);
  const [chapterName, setChapterName] = useState("");
  /** 正在编辑状态 / 摘要的节点。 */
  const [editingMeta, setEditingMeta] = useState<string | null>(null);
  const [metaDraft, setMetaDraft] = useState<{ status: NodeStatus; synopsis: string } | null>(
    null
  );
  const [drag, setDrag] = useState<DragState | null>(null);

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

  /* ---------- 拖放 ---------- */

  /**
   * 计算落点意图。
   *
   * 用指针相对条目中线的位置区分三个意图：上半区 = 插到它前面、
   * 中带 = 移进它内部（仅卷可作容器）、下半区 = 插到它后面。
   * 排序与升降级挤在同一个手势里，若不区分，拖到卷上到底
   * 是"排到卷前面"还是"挪进卷里"会变得不可预期。
   */
  function resolveIntent(
    e: React.DragEvent,
    node: OutlineNode,
    canNest: boolean
  ): DropIntent {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    if (canNest && ratio > 0.35 && ratio < 0.7) {
      return { kind: "inside", parentId: node.id };
    }
    return {
      kind: ratio < 0.5 ? "before" : "after",
      parentId: node.parentId,
    };
  }

  /**
   * 提交拖放。
   *
   * `targetIndex` 语义是「把被拖节点从原位置取出后，插入到目标下标处」，
   * 因此"落在某节点之后"= 该节点在列表里的下标 + 1（不含自身）。
   */
  function commitDrop(intent: DropIntent | null) {
    if (!drag) return;
    const { nodeId } = drag;
    setDrag(null);
    if (!intent) return;

    if (intent.kind === "inside") {
      /* 移进卷内：追加到该卷末尾。 */
      void onMoveNode(nodeId, intent.parentId, Number.MAX_SAFE_INTEGER);
      return;
    }

    const siblings = chaptersByVolume.get(intent.parentId) ?? [];
    const at = siblings.findIndex((n) => n.id === nodeId);
    const target = intent.kind === "before" ? at : at < 0 ? 0 : at;
    void onMoveNode(nodeId, intent.parentId, target);
  }

  /* 拖放反馈：当前落点的指示线 / 高亮。 */
  function dropClass(intent: DropIntent | null): string {
    if (!drag || !intent || drag.intent?.kind !== intent.kind) return "";
    if (drag.intent.parentId !== intent.parentId) return "";
    return intent.kind === "inside"
      ? "ring-1 ring-primary bg-accent/60"
      : intent.kind === "before"
        ? "border-t-2 border-primary"
        : "border-b-2 border-primary";
  }

  /* ---------- 状态 / 摘要 ---------- */

  function openMeta(node: OutlineNode) {
    setEditingMeta(node.id);
    setMetaDraft({ status: node.status, synopsis: node.synopsis });
  }

  async function commitMeta() {
    if (!editingMeta || !metaDraft) return;
    await onUpdateNode(editingMeta, {
      status: metaDraft.status,
      synopsis: metaDraft.synopsis,
    });
    setEditingMeta(null);
    setMetaDraft(null);
  }

  function renderChapterList(parentId: string | null) {
    const list = chaptersByVolume.get(parentId) ?? [];
    if (!list.length) return null;
    return (
      <ul className="flex flex-col">
        {list.map((node) => {
          const intent: DropIntent = {
            kind: "before",
            parentId,
          };
          const isDragging = drag?.nodeId === node.id;
          if (editingMeta === node.id && metaDraft) {
            return (
              <li key={node.id} className="px-2 py-1">
                <div className="flex flex-col gap-1.5 rounded-md border bg-background p-1.5">
                  <Select
                    value={metaDraft.status}
                    onValueChange={(v) =>
                      setMetaDraft({ ...metaDraft, status: v as NodeStatus })
                    }
                  >
                    <SelectTrigger className="h-7 text-xs" aria-label={t("Editor.node.status")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">{t("Editor.node.status.draft")}</SelectItem>
                      <SelectItem value="revising">
                        {t("Editor.node.status.revising")}
                      </SelectItem>
                      <SelectItem value="final">{t("Editor.node.status.final")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    autoFocus
                    value={metaDraft.synopsis}
                    placeholder={t("Editor.node.synopsis")}
                    aria-label={t("Editor.node.synopsis")}
                    className="h-7 text-xs"
                    onChange={(e) =>
                      setMetaDraft({ ...metaDraft, synopsis: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === "Enter") void commitMeta();
                      if (e.key === "Escape") setEditingMeta(null);
                    }}
                  />
                  <div className="flex gap-1">
                    <Button size="sm" className="h-6 flex-1 text-xs" onClick={() => void commitMeta()}>
                      {t("Editor.chapter.confirmRename")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 flex-1 text-xs"
                      onClick={() => setEditingMeta(null)}
                    >
                      {t("Editor.chapter.cancelRename")}
                    </Button>
                  </div>
                </div>
              </li>
            );
          }
          return (
          <li key={node.id} className={["group flex items-center", isDragging ? "opacity-40" : ""].join(" ")}>
            {/*
             * 行容器而非直接用 button：状态 / 摘要编辑是同级按钮，
             * 嵌套 button 属于非法 HTML，浏览器还会连带吃掉点击事件。
             */}
            <div
              draggable
              aria-grabbed={isDragging}
              title={t("Editor.node.dragHint")}
              onClick={() => setCurrentChapterId(node.id)}
              onDragStart={() => setDrag({ nodeId: node.id, intent: null })}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => {
                e.preventDefault();
                if (!drag || drag.nodeId === node.id) return;
                setDrag({ nodeId: drag.nodeId, intent: resolveIntent(e, node, false) });
              }}
              onDrop={(e) => {
                e.preventDefault();
                commitDrop(resolveIntent(e, node, false));
              }}
              className={[
                "flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-md py-1.5 pr-1 text-left text-sm transition-colors active:cursor-grabbing",
                "pl-8 hover:bg-accent hover:text-accent-foreground",
                currentChapterId === node.id
                  ? "bg-accent/60 font-medium text-accent-foreground"
                  : "text-muted-foreground",
                dropClass(intent),
              ].join(" ")}
            >
              <FileText className="icon-sm shrink-0" />
              <span className="truncate">{node.title}</span>
              {/* 状态点：非草稿才标，否则整棵树都是点、看不出差别。 */}
              {node.status !== "draft" ? (
                <span
                  className={[
                    "size-1.5 shrink-0 rounded-full",
                    node.status === "final" ? "bg-emerald-500" : "bg-amber-500",
                  ].join(" ")}
                  title={t(`Editor.node.status.${node.status}`)}
                />
              ) : null}
              {node.synopsis ? (
                <span className="ml-auto max-w-[40%] truncate text-xs text-muted-foreground/60">
                  {node.synopsis}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              aria-label={t("Editor.node.editMeta")}
              title={t("Editor.node.editMeta")}
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover:opacity-100"
              onClick={() => openMeta(node)}
            >
              <Settings2 className="icon-sm" />
            </button>
          </li>
          );
        })}
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
          /* 卷同时是「排序项」和「容器」，所以 canNest 为 true。 */
          const volumeIntent: DropIntent = { kind: "inside", parentId: volume.id };
          return (
            <div
              key={volume.id}
              className={[
                "mb-1",
                drag?.nodeId === volume.id ? "opacity-40" : "",
                dropClass(volumeIntent),
              ].join(" ")}
            >
              <div
                className="group flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent/40"
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!drag || drag.nodeId === volume.id) return;
                  setDrag({
                    nodeId: drag.nodeId,
                    intent: resolveIntent(e, volume, true),
                  });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  commitDrop(resolveIntent(e, volume, true));
                }}
              >
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
        {/*
         * 根层拖放区：把章从卷里拖出来必须有落点，
         * 否则"移出到顶层"这个动作在界面上无法完成。
         * 拖拽进行中才显示，避免平时占掉空白处。
         */}
        {drag ? (
          <div
            className={[
              "mt-1 rounded-md border border-dashed px-2 py-1.5 text-center text-xs transition-colors",
              drag.intent?.kind !== "inside" && drag.intent?.parentId === null
                ? "border-primary bg-accent/60 text-accent-foreground"
                : "border-border text-muted-foreground/60",
            ].join(" ")}
            onDragOver={(e) => {
              e.preventDefault();
              if (!drag) return;
              setDrag({ nodeId: drag.nodeId, intent: { kind: "after", parentId: null } });
            }}
            onDrop={(e) => {
              e.preventDefault();
              commitDrop({ kind: "after", parentId: null });
            }}
          >
            {t("Editor.node.moveOut")}
          </div>
        ) : null}
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
