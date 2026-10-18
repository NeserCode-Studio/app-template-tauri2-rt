import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronRight, FileText, GripVertical, Plus, Settings2, Trash2 } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/composables";
import { useOutline } from "@/contexts/outline";
import type { OutlineNode } from "@/shared/schema";
import { createLogger } from "@/lib/logger";
import { computeIndexByPosition } from "@/lib/outline-move";

import ChapterMetaDialog from "./ChapterMetaDialog";
import CreateNodeDialog from "./CreateNodeDialog";

const log = createLogger("OutlinePane");

export interface OutlinePaneProps {
  /** 新建章节：创建后自动打开。 */
  onCreateChapter: (
    title: string,
    parentVolumeId: string | null,
    meta?: { status?: "draft" | "revising" | "final"; synopsis?: string }
  ) => Promise<void>;
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
  /** 删除整卷（连同其下所有章进回收站）；父级负责确认与落盘。 */
  onDeleteVolume: (volumeId: string) => void;
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
  /*
   * 命中范围要收窄到「可落点的 id」。
   *
   * 不收窄的话，正在被拖动的那一行自己也参与碰撞：指针移到 A 上方时，
   * 若 A 自己比真正的目标更近，over 会一直是 A，解析出来就是
   * "插到自己前面"——索引等于原位，落盘后顺序看起来毫无变化。
   */
  const hits = args.droppableContainers.filter((c) => {
    const id = String(c.id);
    if (id.startsWith(NODE_PREFIX)) return id !== args.active.id;
    return id.startsWith(DROP_PREFIX);
  });
  const pointerHits = pointerWithin({ ...args, droppableContainers: hits });
  const nodeHits = pointerHits.filter((hit) => String(hit.id).startsWith(NODE_PREFIX));
  if (nodeHits.length) return nodeHits;
  if (pointerHits.length) return pointerHits;
  return closestCenter({ ...args, droppableContainers: hits });
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
  sessionActive,
  onSelect,
  onEditMeta,
  registerEl,
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
  /**
   * 拖拽会话是否进行中。
   *
   * dnd-kit 的 `transform` 只应在拖拽期间生效。松手落盘后真实顺序已变，
   * 若仍挂着预览位移，卡片会被视觉推回旧位置，用户看到的就是"换了序又弹回"。
   * 所以会话结束就一律不再应用 transform。
   */
  sessionActive: boolean;
  onSelect: () => void;
  onEditMeta: () => void;
  /** 登记 DOM 节点：落点靠实时几何计算，必须能拿到元素。 */
  registerEl: (el: HTMLElement | null) => void;
  editMetaLabel: string;
  dragLabel: string;
  metaLabel: string;
  wordsLabel: string;
  statusLabel: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: NODE_PREFIX + node.id,
    data: { type: "chapter", nodeId: node.id },
  });

  return (
    <li
      ref={(el) => {
        setNodeRef(el);
        registerEl(el);
      }}
      style={{
        transform: sessionActive ? CSS.Transform.toString(transform) : undefined,
        /*
         * 松手后不留 transition：位移已随真实顺序一起消失，若还保留过渡动画，
         * 卡片会从落点再滑回旧槽位，看上去像"顺序没换"。
         * 拖拽期间（sessionActive）保留，错位预览才有平滑跟随。
         */
        transition: sessionActive ? transition : undefined,
      }}
      className="group relative px-1"
    >
      <div
        className={[
          "flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-md border border-transparent py-1.5 pr-6 pl-7 text-left transition-colors",
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
         *
         * 这里只做手势激活，落点不再依赖 dnd-kit 的碰撞结果：
         * 松手时直接读元素的几何位置算下标（见 handleDragEnd）。
         */}
        <span
          {...listeners}
          aria-label={dragLabel}
          title={dragLabel}
          className="absolute left-0 top-0 flex h-full w-6 cursor-grab items-center justify-center text-muted-foreground/30 opacity-0 transition-opacity hover:text-muted-foreground/70 focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="size-3" />
        </span>
        <button
          type="button"
          aria-label={editMetaLabel}
          title={editMetaLabel}
          className="absolute right-1.5 bottom-1 flex size-5 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover:opacity-100"
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
  onDeleteVolume,
}: OutlinePaneProps) {
  const { t } = useI18n();
  const { chapters, volumes, chapterMetas, currentChapterId, setCurrentChapterId } = useOutline();

  /** 新建卷对话框。 */
  const [volumeDialog, setVolumeDialog] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** 新建章节对话框的目标父级，undefined 表示未打开。 */
  const [chapterDialogIn, setChapterDialogIn] = useState<string | null | undefined>(undefined);
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
  /** 章节点 DOM：位置法算插入下标时要读实时矩形。 */
  const nodeEls = useRef(new Map<string, HTMLElement>());
  /**
   * 拖拽开始那一刻的布局快照（元素自身几何，不含 sortable 的 transform）。
   *
   * 落点不能靠松手瞬间 `getBoundingClientRect()` 现场读：dnd-kit 把被拖卡片钉在
   * 原位、只用 transform 位移其它兄弟节点，所以此刻读到的仍是起始矩形。
   */
  const layoutAtStart = useRef<{
    /**
     * 抓取瞬间的指针纵坐标。
     *
     * 落点必须按指针位置算，不能按卡片中心算：把手在卡片偏下处，用户按住的位置
     * 与卡片中心相差一个固定偏移。dnd-kit 的碰撞检测用的就是指针坐标，若我们按
     * 卡片中心判定，两者会差这一个偏移量——拖动距离越小，偏移占比越大，于是
     * 出现"预览已经换位、松手却判定未变"。统一到指针坐标系即可对齐。
     */
    pointerY: number;
    centers: Map<string, number>;
  } | null>(null);

  const activeNode = activeId ? nodeById.get(activeId.slice(NODE_PREFIX.length)) ?? null : null;
  /** 命中具体节点时抑制容器高亮，避免同时亮两处。 */
  const overRef = overId ? parseDroppableId(overId) : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    const centers = new Map<string, number>();
    for (const [id, el] of nodeEls.current) {
      const r = el.getBoundingClientRect();
      centers.set(id, r.top + r.height / 2);
    }
    /*
     * 指针起点取自激活事件本身；拿不到（非指针传感器）才退回卡片中心。
     * `active.rect.current.initial` 在 dragStart 时机为 null，不能依赖。
     */
    const activeEl = nodeEls.current.get(String(e.active.id).slice(NODE_PREFIX.length));
    const rect = activeEl ? activeEl.getBoundingClientRect() : null;
    const pointerY =
      e.activatorEvent instanceof PointerEvent
        ? e.activatorEvent.clientY
        : rect
          ? rect.top + rect.height / 2
          : null;
    if (pointerY !== null) layoutAtStart.current = { pointerY, centers };
    log.debug("[outline-dnd] start", {
      active: String(e.active.id),
      registered: nodeEls.current.size,
    });
  }

  function handleDragOver(e: DragOverEvent) {
    setOverId(e.over ? String(e.over.id) : null);
  }

  function handleDragCancel() {
    setActiveId(null);
    setOverId(null);
    layoutAtStart.current = null;
  }

  /**
   * 落点不再依赖 dnd-kit 的 `over`。
   *
   * 碰撞检测在 WebView 里反复失准（预览会动、松手复原），所以改成
   * 读松手瞬间的真实几何：取被拖元素的纵向中心，在同级里找第一个
   * 中心在它下方的元素。判断依据与用户看到的预览完全一致。
   */
  function handleDragEnd(e: DragEndEvent) {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    log.debug("[outline-dnd] end", { active, over });
    setActiveId(null);
    setOverId(null);
    if (!over) {
      log.warn("[outline-dnd] abort: over is null");
      return;
    }

    const nodeId = active.slice(NODE_PREFIX.length);
    const source = nodeById.get(nodeId);
    if (!source) {
      log.warn("[outline-dnd] abort: node not found", { nodeId });
      return;
    }

    /*
     * 父级归属仍取 `over`：跨卷升降级需要知道落在哪个容器里，
     * 而容器体积大、位置判别可靠，不依赖精细碰撞。
     */
    const ref = parseDroppableId(over);
    const targetParentId = ref?.kind === "into" ? ref.parentId : (ref ? nodeById.get(ref.nodeId)?.parentId ?? source.parentId : source.parentId);

    if (!nodeEls.current.has(nodeId)) {
      log.warn("[outline-dnd] abort: element not registered", {
        nodeId,
        known: [...nodeEls.current.keys()],
      });
      return;
    }
    /*
     * 落点几何必须来自「拖拽开始时的布局 + 指针位移」：兄弟节点保持起始中心，
     * 指针当前位置 = 抓取点 + delta.y。绕开 sortable transform 的渲染时序，
     * 也和 dnd-kit 的指针坐标碰撞判定对齐。
     */
    const snap = layoutAtStart.current;
    if (!snap) {
      log.warn("[outline-dnd] abort: no drag snapshot", { nodeId });
      return;
    }
    const centers: number[] = [];
    for (const n of chaptersByVolume.get(targetParentId) ?? []) {
      if (n.id === nodeId) continue;
      const center = snap.centers.get(n.id);
      if (center === undefined) continue;
      centers.push(center);
    }
    const draggedCenter = snap.pointerY + e.delta.y;
    const index = computeIndexByPosition(centers, draggedCenter);
    const siblings = chaptersByVolume.get(targetParentId) ?? [];
    const without = siblings.filter((n) => n.id !== nodeId);
    log.debug("[outline-dnd] computed", {
      nodeId,
      targetParentId,
      deltaY: Math.round(e.delta.y),
      draggedCenter: Math.round(draggedCenter),
      centers: centers.map((c) => Math.round(c)),
      index,
    });
    /* 落回原位就不写盘，避免无意义的 outline 落盘与全树刷新。 */
    if (index < 0 || index > without.length) {
      log.warn("[outline-dnd] abort: index out of range", { index, len: without.length });
      return;
    }
    const before = siblings.map((n) => n.id).join(",");
    const after = [...without.slice(0, index), { id: nodeId }, ...without.slice(index)]
      .map((n) => n.id)
      .join(",");
    if (before === after) {
      log.warn("[outline-dnd] abort: order unchanged", { index });
      return;
    }
    log.debug("[outline-dnd] committing move", { nodeId, targetParentId, index });
    void onMoveNode(nodeId, targetParentId, index);
    layoutAtStart.current = null;
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
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {list.map((node, i) => (
              <SortableChapter
                key={node.id}
                node={node}
                index={i}
                selected={currentChapterId === node.id}
                dragging={activeId === NODE_PREFIX + node.id}
                sessionActive={Boolean(activeId)}
                onSelect={() => setCurrentChapterId(node.id)}
                onEditMeta={() => setMetaTarget(node)}
                registerEl={(el) => {
                  if (el) nodeEls.current.set(node.id, el);
                  else nodeEls.current.delete(node.id);
                }}
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
      <CreateNodeDialog
        open={volumeDialog}
        title={t("Editor.side.addVolume")}
        placeholder={t("Editor.side.volume")}
        onOpenChange={setVolumeDialog}
        onConfirm={(input) => onCreateVolume(input.title)}
      />
      <CreateNodeDialog
        open={chapterDialogIn !== undefined}
        title={t("Editor.side.addChapter")}
        placeholder={t("Editor.side.chapter")}
        volumes={volumes}
        defaultParentId={chapterDialogIn}
        withMeta
        onOpenChange={(o) => {
          if (!o) setChapterDialogIn(undefined);
        }}
        onConfirm={(input) =>
          onCreateChapter(input.title, input.parentId, {
            status: input.status,
            synopsis: input.synopsis,
          })
        }
      />
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
        {/*
         * 新建卷与新建章合并成一个入口。
         *
         * 两个图标按钮并排时，用户得先分辨哪个是哪个；加上"章"是主路径、
         * "卷"是低频操作，并排等权重反而把主路径藏起来了。改成下拉后，
         * 主路径在一个明确的下拉项上，低频项排在下面。
         */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={t("Editor.side.add")}
              title={t("Editor.side.add")}
            >
              <Plus className="icon-sm" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-32">
            <DropdownMenuItem onSelect={() => setChapterDialogIn(null)}>
              <Plus className="icon-sm" />
              {t("Editor.side.addChapter")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setVolumeDialog(true)}>
              <BookOpen className="icon-sm" />
              {t("Editor.side.addVolume")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
        <div className="scrollbar-app min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-2 pb-3">
          {/* 卷分组 */}
          {volumes.map((volume, vi) => {
            const isCollapsed = collapsed[volume.id];
            return (
              <DropZone
                key={volume.id}
                parentId={volume.id}
                dragging={Boolean(activeId) && overRef?.kind !== "before"}
                className="mb-1"
              >
                {/*
                 * 卷与卷之间的分割线。
                 *
                 * 放进 DropZone 内部而不是外层：DropZone 是可放置区域，
                 * 在它外面插元素不影响命中，但在它内部插一个纯装饰节点
                 * 不会把"这一整块卷"的可放置范围割裂。
                 *
                 * 首个卷不加：顶边紧贴面板上沿，画一条线只会显得是
                 * 被裁掉一半的边框。
                 */}
                {vi > 0 ? (
                  <div
                    className="mx-2 mb-1.5 h-px bg-border/70"
                    aria-hidden="true"
                  />
                ) : null}
                <div className="group flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent/40">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((prev) => ({ ...prev, [volume.id]: !prev[volume.id] }))
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <ChevronRight
                      className={[
                        "icon-sm shrink-0 text-muted-foreground transition-transform",
                        isCollapsed ? "" : "rotate-90",
                      ].join(" ")}
                    />
                    <span className="truncate text-sm font-medium">{volume.title}</span>
                    {/*
                     * 章数跟在名称后面而不是推到最右：名称与数量是同一条信息
                     * （"这卷有多少章"），推到右侧会被两端的操作按钮挤远，
                     * 视线要来回扫才联系得上。
                     */}
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground/60">
                      {(chaptersByVolume.get(volume.id) ?? []).length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setChapterDialogIn(volume.id)}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-accent-foreground"
                    aria-label={t("Editor.side.addChapter")}
                  >
                    <Plus className="icon-sm" />
                  </button>
                  {/* 删卷：与加章同排，悬停卷行时出现。 */}
                  <button
                    type="button"
                    onClick={() => onDeleteVolume(volume.id)}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t("Editor.volume.delete")}
                    title={t("Editor.volume.delete")}
                  >
                    <Trash2 className="icon-sm" />
                  </button>
                </div>

                {!isCollapsed ? (
                  <>
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
            {/*
             * 卷内所有章排在前面，未入卷的章跟在后面，两者之间也要有线。
             * 分割线画在这里而不是依赖上一版"每个卷之间画线"——那一版
             * 只切开了卷与卷，卷与未入卷区之间反而是连着的。
             * 无卷时（全是未入卷章）不需要线，顶端不该凭空多一道。
             */}
            {volumes.length && (chaptersByVolume.get(null) ?? []).length ? (
              <div className="mx-2 mb-1.5 h-px bg-border/70" aria-hidden="true" />
            ) : null}
            {renderChapterList(null)}
          </DropZone>

          {!volumes.length && !chapters.length ? (
            <div className="px-2 py-6 text-center">
              <p className="text-xs text-muted-foreground">{t("Editor.side.emptyWork")}</p>
            </div>
          ) : null}
        </div>
        </div>

        {/* dropAnimation 置空：浮层默认会飞回落点，我们已落盘重排，无需这层回落动画。 */}
        <DragOverlay dropAnimation={null}>
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
