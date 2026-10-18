import { useMemo, useState } from "react";
import { BookOpen, ChevronRight, FileText, GripVertical, Plus, Settings2 } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
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

import NodeMetaEditor, { type NodeStatus } from "./NodeMetaEditor";

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

/** 可拖拽的章节行。 */
function SortableChapter({
  node,
  selected,
  dragging,
  onSelect,
  onEditMeta,
  editMetaLabel,
}: {
  node: OutlineNode;
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onEditMeta: () => void;
  editMetaLabel: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: NODE_PREFIX + node.id,
    data: { type: "chapter", nodeId: node.id },
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="group flex items-center"
    >
      <div
        className={[
          "flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-md py-1.5 pr-1 pl-2 text-left text-sm transition-colors active:cursor-grabbing",
          "hover:bg-accent hover:text-accent-foreground",
          selected ? "bg-accent/60 font-medium text-accent-foreground" : "text-muted-foreground",
          isDragging || dragging ? "opacity-40" : "",
        ].join(" ")}
        onClick={onSelect}
        title={node.title}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="icon-sm shrink-0 text-muted-foreground/40" />
        <FileText className="icon-sm shrink-0" />
        <span className="truncate">{node.title}</span>
        {/* 状态点：非草稿才标，否则整棵树都是点、看不出差别。 */}
        {node.status !== "draft" ? (
          <span
            className={[
              "size-1.5 shrink-0 rounded-full",
              node.status === "final" ? "bg-emerald-500" : "bg-amber-500",
            ].join(" ")}
          />
        ) : null}
        {node.synopsis ? (
          <span className="ml-auto max-w-[40%] truncate text-xs text-muted-foreground/60">
            {node.synopsis}
          </span>
        ) : null}
        <button
          type="button"
          aria-label={editMetaLabel}
          title={editMetaLabel}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover:opacity-100"
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
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

    const ref = parseDroppableId(over);
    const nodeId = active.slice(NODE_PREFIX.length);
    if (!ref) return;

    if (ref.kind === "into") {
      void onMoveNode(nodeId, ref.parentId, Number.MAX_SAFE_INTEGER);
      return;
    }

    const target = nodeById.get(ref.nodeId);
    if (!target) return;
    const siblings = chaptersByVolume.get(target.parentId) ?? [];
    const index = siblings.findIndex((n) => n.id === target.id);
    void onMoveNode(nodeId, target.parentId, index);
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
      <SortableContext
        items={list.map((n) => NODE_PREFIX + n.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col">
          {list.map((node) =>
            editingMeta === node.id && metaDraft ? (
              <li key={node.id} className="px-2 py-1">
                <NodeMetaEditor
                  node={node}
                  status={metaDraft.status}
                  synopsis={metaDraft.synopsis}
                  onChange={(patch) =>
                    setMetaDraft((prev) =>
                      prev
                        ? {
                            status: patch.status ?? prev.status,
                            synopsis: patch.synopsis ?? prev.synopsis,
                          }
                        : prev
                    )
                  }
                  onSubmit={() => void commitMeta()}
                  onCancel={() => {
                    setEditingMeta(null);
                    setMetaDraft(null);
                  }}
                />
              </li>
            ) : (
              <SortableChapter
                key={node.id}
                node={node}
                selected={currentChapterId === node.id}
                dragging={activeId === NODE_PREFIX + node.id}
                onSelect={() => setCurrentChapterId(node.id)}
                onEditMeta={() => openMeta(node)}
                editMetaLabel={t("Editor.node.editMeta")}
              />
            )
          )}
        </ul>
      </SortableContext>
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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
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
