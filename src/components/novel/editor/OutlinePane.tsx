import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronRight, FileText, GripVertical, Plus, Settings2 } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type CollisionDetection,
  closestCenter,
  pointerWithin,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/composables";
import { useOutline } from "@/contexts/outline";
import type { OutlineNode } from "@/shared/schema";

import ChapterMetaDialog from "./ChapterMetaDialog";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  /** 更新节点属性（状态 / 摘要 / 情节小结）。 */
  onUpdateNode: (
    nodeId: string,
    patch: {
      status?: "draft" | "revising" | "final";
      synopsis?: string;
      plotSummary?: string;
    }
  ) => Promise<void>;
}

/**
 * 落点 id 编码。
 *
 * - `drop:<parentId|root>`：追加到该父级末尾（root 表示顶层）
 * - `node:<nodeId>`：插到该节点之前（保持同级）
 *
 * 容器与排序项分开成两种 id，才能让"拖进卷"和"同卷换位"在
 * 同一个手势里有确定语义。
 */
const DROP_PREFIX = "drop:";
const NODE_PREFIX = "node:";
const ROOT = "root";

function dropInto(parentId: string | null): string {
  return `${DROP_PREFIX}${parentId ?? ROOT}`;
}

type DropRef =
  | { kind: "into"; parentId: string | null }
  | { kind: "before"; nodeId: string };

function parseDroppableId(id: string): DropRef | null {
  if (id.startsWith(DROP_PREFIX)) {
    const raw = id.slice(DROP_PREFIX.length);
    return { kind: "into", parentId: raw === ROOT ? null : raw };
  }
  if (id.startsWith(NODE_PREFIX)) return { kind: "before", nodeId: id.slice(NODE_PREFIX.length) };
  return null;
}

/**
 * 碰撞检测：节点优先于容器。
 *
 * 卷容器（`drop:<id>`）把整组章节都包在里面，它的几何中心远大于单个章节。
 * 用 closestCenter 时，靠近列表上下两端往往"容器更近"，于是松手被解析成
 * "追加到卷末尾"——看起来就是能拖、但顺序不变。
 *
 * 规则很简单：指针正落在某个章节行上就用那一行（`node:`），
 * 只有指针落在空白处（章节之间、卷的空白区）才用容器（`drop:`）。
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  const nodeHits = pointerHits.filter((hit) => String(hit.id).startsWith(NODE_PREFIX));
  if (nodeHits.length) return nodeHits;
  if (pointerHits.length) return pointerHits;
  return closestCenter(args);
};

/**
 * 拖拽阈值：10px。
 *
 * 5px 时一次点击的行也会被判定成拖拽，用户会以为"点一下就乱序"。
 * 侧栏行窄，10px 仍是很小的位移，不影响手感。
 */
const DRAG_ACTIVATION = { distance: 10 };

/**
 * 相对时间：侧栏要的是"多久之前"，不是绝对时刻。
 *
 * 绝对时间在长列表里既占宽又难扫读——用户真正想知道的是
 * "这章是刚写的还是三天前的"。
 */
function relativeTime(ts: number, now: number): string {
  if (!ts) return "";
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 60) return "刚刚";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.round(hour / 24);
  if (day < 30) return `${day} 天前`;
  const month = Math.round(day / 30);
  if (month < 12) return `${month} 个月前`;
  return `${Math.round(month / 12)} 年前`;
}

/** 可拖拽的章节行。 */
function SortableChapter({
  node,
  index,
  selected,
  dragging,
  onSelect,
  onEditMeta,
  editMetaLabel,
  dragLabel,
  metaLabel,
  wordsLabel,
  statusLabel,
}: {
  node: OutlineNode;
  index: number;
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onEditMeta: () => void;
  editMetaLabel: string;
  dragLabel: string;
  metaLabel: string;
  wordsLabel: string;
  statusLabel: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: NODE_PREFIX + node.id,
    data: { type: "chapter", nodeId: node.id },
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="group relative px-1"
    >
      <div
        className={[
          "flex min-w-0 cursor-grab flex-col gap-0.5 rounded-md border border-transparent py-1.5 pr-6 pl-7 text-left transition-colors active:cursor-grabbing",
          "hover:bg-accent hover:text-accent-foreground",
          selected
            ? "border-border bg-accent/60 text-accent-foreground"
            : "text-muted-foreground",
          isDragging || dragging ? "opacity-40" : "",
        ].join(" ")}
        onClick={onSelect}
        title={node.title}
        {...attributes}
      >
        <div className="flex items-center gap-1.5">
          {/* 序号：只在卷内计数，方便对照「第几章」。 */}
          <span className="shrink-0 text-[10px] text-muted-foreground/50 tabular-nums">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="truncate text-sm font-medium">{node.title}</span>
          {/* 状态点：非草稿才标，否则整棵树都是点、看不出差别。 */}
          {node.status !== "draft" ? (
            <span
              className={[
                "size-1.5 shrink-0 rounded-full",
                node.status === "final" ? "bg-emerald-500" : "bg-amber-500",
              ].join(" ")}
              title={statusLabel}
            />
          ) : null}
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
            {wordsLabel}
          </span>
        </div>
        {node.synopsis ? (
          <span className="line-clamp-1 text-[11px] text-muted-foreground/70">
            {node.synopsis}
          </span>
        ) : null}
        {metaLabel ? (
          <span className="text-[10px] text-muted-foreground/50">{metaLabel}</span>
        ) : null}
        {/*
         * 拖拽只挂在把手，不挂整行。
         *
         * 整行作为拖拽热区时，任何一次按下都会进入 PointerSensor 的
         * 判定，与 WebView2 的原生文本选区互相干扰——拖到一半选区
         * 抢走 pointermove，松手时 dnd-kit 认为手势已结束，顺序不变。
         * 只挂把手后，行的其余部分回归纯粹的点击与选中。
         */}
        <span
          {...listeners}
          aria-label={dragLabel}
          title={dragLabel}
          className="absolute left-1 top-0 flex h-full w-4 cursor-grab items-center justify-center text-muted-foreground/30 opacity-0 transition-opacity hover:text-muted-foreground/70 focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="size-3" />
        </span>
        <button
          type="button"
          aria-label={editMetaLabel}
          title={editMetaLabel}
          className="absolute bottom-0.5 right-1 flex size-5 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onEditMeta();
          }}
        >
          <Settings2 className="icon-sm" />
        </button>
      </div>
    </li>
  );
}

/** 容器落点：卷本身、以及顶层拖出区。 */
function DropZone({
  parentId,
  dragging,
  className,
  children,
}: {
  parentId: string | null;
  dragging: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropInto(parentId) });
  return (
    <div
      ref={setNodeRef}
      className={[
        className ?? "",
        dragging && isOver ? "rounded-md bg-accent/50 ring-1 ring-primary" : "",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

/**
 * 左侧结构树：卷分组 + 章列表。
 *
 * 拖放走 dnd-kit（PointerSensor + 5px 激活阈值），单击选中章节
 * 不会被误判为拖拽；旧版 HTML5 DnD 在 Tauri WebView 上事件不稳定，
 * 已整体移除。
 */
export default function OutlinePane({
  onCreateChapter,
  onCreateVolume,
  onMoveNode,
  onUpdateNode,
}: OutlinePaneProps) {
  const { t } = useI18n();
  const { chapters, volumes, chapterMetas, currentChapterId, setCurrentChapterId } = useOutline();

  const [addingVolume, setAddingVolume] = useState(false);
  const [volumeName, setVolumeName] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** 记录"正在给哪个卷添加章"，null 表示添加到根。 */
  const [addingChapterIn, setAddingChapterIn] = useState<string | null | undefined>(undefined);
  const [chapterName, setChapterName] = useState("");
  /** 章节详情对话框的目标节点。 */
  const [metaTarget, setMetaTarget] = useState<OutlineNode | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  /** 相对时间的基准：每分钟刷新一次即可，太频繁只会白白重渲染。 */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: DRAG_ACTIVATION })
  );

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
  const chaptersByVolume = useMemo(() => {
    const map = new Map<string | null, OutlineNode[]>();
    for (const c of chapters) {
      const list = map.get(c.parentId) ?? [];
      list.push(c);
      map.set(c.parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }, [chapters]);

  const nodeById = useMemo(() => new Map(chapters.map((c) => [c.id, c])), [chapters]);

  const activeNode = activeId ? nodeById.get(activeId.slice(NODE_PREFIX.length)) ?? null : null;
  /** 命中具体节点时抑制容器高亮，避免同时亮两处。 */
  const overRef = overId ? parseDroppableId(overId) : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragOver(e: DragOverEvent) {
    setOverId(e.over ? String(e.over.id) : null);
  }

  function handleDragCancel() {
    setActiveId(null);
    setOverId(null);
  }

  /**
   * `targetIndex` 语义是「把被拖节点从原位置取出后，插入到目标下标处」，
   * 所以"落在某节点之前"就是目标节点在其同级列表里的下标。
   */
  function handleDragEnd(e: DragEndEvent) {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    setActiveId(null);
    setOverId(null);
    if (!over) return;

    const nodeId = active.slice(NODE_PREFIX.length);
    const ref = parseDroppableId(over);
    if (!ref) return;

    if (ref.kind === "into") {
      void onMoveNode(nodeId, ref.parentId, Number.MAX_SAFE_INTEGER);
      return;
    }

    /*
     * 同级换位的下标语义。
     *
     * 服务端的 targetIndex 是「取出自己之后插入的位置」，因此这里必须
     * 先在**不含自己**的列表里数出目标的下标。原来直接用含自己的
     * 列表下标，往下拖时会多算一位，结果永远是"原地不动"——
     * 表现就是能拖起来但改不了顺序。
     */
    const target = nodeById.get(ref.nodeId);
    if (!target) return;
    const siblings = (chaptersByVolume.get(target.parentId) ?? []).filter(
      (n) => n.id !== nodeId
    );
    const index = siblings.findIndex((n) => n.id === target.id);
    void onMoveNode(nodeId, target.parentId, index);
  }

  /* ---------- 章节详情 ---------- */

  function renderChapterList(parentId: string | null) {
    const list = chaptersByVolume.get(parentId) ?? [];
    if (!list.length) return null;
    return (
      <SortableContext
        items={list.map((n) => NODE_PREFIX + n.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col">
          {list.map((node, i) => (
              <SortableChapter
                key={node.id}
                node={node}
                index={i}
                selected={currentChapterId === node.id}
                dragging={activeId === NODE_PREFIX + node.id}
                onSelect={() => setCurrentChapterId(node.id)}
                onEditMeta={() => setMetaTarget(node)}
                editMetaLabel={t("Editor.node.editMeta")}
                dragLabel={t("Editor.node.dragHint")}
                statusLabel={t(`Editor.node.status.${node.status}`)}
                wordsLabel={
                  chapterMetas[node.id]
                    ? `${chapterMetas[node.id].words} ${t("Editor.chapter.words")}`
                    : ""
                }
                metaLabel={
                  chapterMetas[node.id]
                    ? relativeTime(chapterMetas[node.id].updatedAt, now)
                    : ""
                }
              />
          ))}
        </ul>
      </SortableContext>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ChapterMetaDialog
        open={metaTarget !== null}
        node={metaTarget}
        stats={
          metaTarget && chapterMetas[metaTarget.id]
            ? {
                words: `${chapterMetas[metaTarget.id].words} ${t("Editor.chapter.words")}`,
                updated: relativeTime(chapterMetas[metaTarget.id].updatedAt, now),
              }
            : undefined
        }
        onOpenChange={(o) => {
          if (!o) setMetaTarget(null);
        }}
        onSave={onUpdateNode}
      />
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

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* 树体 */}
        <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-3">
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
              <DropZone
                key={volume.id}
                parentId={volume.id}
                dragging={Boolean(activeId) && overRef?.kind !== "before"}
                className="mb-1"
              >
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
              </DropZone>
            );
          })}

          {/*
           * 根层拖放区：把章从卷里拖出来必须有落点，
           * 否则"移出到顶层"这个动作在界面上无法完成。
           * 拖拽进行中才显示虚线框，避免平时占掉空白处。
           */}
          <DropZone
            parentId={null}
            dragging={Boolean(activeId) && overRef?.kind !== "before"}
            className={activeId ? "mt-1 rounded-md border border-dashed border-border/60 p-1" : ""}
          >
            {activeId ? (
              <p className="px-1 py-1 text-center text-xs text-muted-foreground/60">
                {t("Editor.node.moveOut")}
              </p>
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
                    if (e.key === "Enter" && !e.nativeEvent.isComposing)
                      void commitChapter(null);
                    if (e.key === "Escape") setAddingChapterIn(undefined);
                  }}
                />
              </div>
            ) : null}
            {renderChapterList(null)}
          </DropZone>

          {!volumes.length &&
          !chapters.length &&
          !addingVolume &&
          addingChapterIn === undefined ? (
            <div className="px-2 py-6 text-center">
              <p className="text-xs text-muted-foreground">{t("Editor.side.emptyWork")}</p>
            </div>
          ) : null}
        </div>
        </ScrollArea>

        <DragOverlay>
          {activeNode ? (
            <div className="flex items-center gap-2 rounded-md bg-accent px-2 py-1.5 text-sm shadow-lg">
              <GripVertical className="icon-sm shrink-0 opacity-60" />
              <FileText className="icon-sm shrink-0" />
              <span className="truncate">{activeNode.title}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
