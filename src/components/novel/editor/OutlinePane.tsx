import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { useLocalStorageState } from "ahooks";
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileText,
  GripVertical,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
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
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { useI18n } from "@/composables";
import { useLibrary } from "@/contexts/library";
import { useOutline } from "@/contexts/outline";
import type { OutlineNode } from "@/shared/schema";
import { createLogger } from "@/lib/logger";
import { computeIndexByPosition } from "@/lib/outline-move";

import ChapterMetaDialog from "./ChapterMetaDialog";
import CreateNodeDialog from "./CreateNodeDialog";
import { useJumpHighlight } from "@/hooks/useJumpHighlight";

const log = createLogger("OutlinePane");
const VOLUME_COLLAPSE_KEY = "novels-yes:editor:volume-collapsed";

export interface OutlinePaneProps {
  /** 打开章节；普通结构树导航必须落到章首。 */
  onSelectChapter: (chapterId: string) => void;
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
      preface?: string;
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
  if (id.startsWith(NODE_PREFIX))
    return { kind: "before", nodeId: id.slice(NODE_PREFIX.length) };
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
  const nodeHits = pointerHits.filter((hit) =>
    String(hit.id).startsWith(NODE_PREFIX)
  );
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
  highlighted,
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
  highlighted: boolean;
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
        transform: sessionActive
          ? CSS.Transform.toString(transform)
          : undefined,
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
        data-outline-chapter={node.id}
        className={[
          "flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-md border py-1.5 pr-6 pl-7 text-left transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          selected
            ? "chapter-row-selected bg-accent/60 text-accent-foreground"
            : "text-muted-foreground border-transparent",
          highlighted ? "jump-highlight" : "",
          isDragging || dragging ? "opacity-40" : "",
        ].join(" ")}
        onClick={onSelect}
        title={node.title}
        aria-current={selected ? "page" : undefined}
        {...attributes}
      >
        <div className="flex items-center gap-1.5">
          {/* 卷内按章序计数；顶层游离章沿用顶层序列位置。 */}
          <span className="text-muted-foreground/50 shrink-0 text-[10px] tabular-nums">
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
          <span className="text-muted-foreground/60 ml-auto shrink-0 text-[10px] tabular-nums">
            {wordsLabel}
          </span>
        </div>
        {node.synopsis ? (
          <span className="text-muted-foreground/70 line-clamp-1 text-[11px]">
            {node.synopsis}
          </span>
        ) : null}
        {metaLabel ? (
          <span className="text-muted-foreground/50 text-[10px]">
            {metaLabel}
          </span>
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
          className="text-muted-foreground/30 hover:text-muted-foreground/70 absolute top-0 left-0 flex h-full w-6 cursor-grab items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="size-3" />
        </span>
        <button
          type="button"
          aria-label={editMetaLabel}
          title={editMetaLabel}
          className="text-muted-foreground/50 hover:bg-accent hover:text-accent-foreground absolute right-1.5 bottom-1 flex size-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
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

/**
 * 卷行。
 *
 * 与章节行共用一套拖拽约定（把手激活、几何算落点、落盘后不留过渡），
 * 差别只在于：卷的把手常驻在左侧而不是悬停才出现——卷的折叠箭头
 * 已经在最左边，再放把手需要另找位置，而卷是低频拖拽对象，
 * 把手可见的额外提示成本可以接受。
 */
function VolumeRow({
  volume,
  isCollapsed,
  currentChapterTitle,
  sessionActive,
  dragging,
  chapterCount,
  currentLabel,
  openCurrentLabel,
  addChapterLabel,
  deleteVolumeLabel,
  editMetaLabel,
  prefaceLabel,
  dragLabel,
  registerEl,
  onToggle,
  onOpenCurrentChapter,
  onAddChapter,
  onEditMeta,
  onDelete,
}: {
  volume: OutlineNode;
  isCollapsed: boolean;
  /** 当前阅读章标题；为空表示这卷不包含正在写的章节。 */
  currentChapterTitle: string | null;
  sessionActive: boolean;
  dragging: boolean;
  chapterCount: number;
  currentLabel: string;
  openCurrentLabel: string;
  addChapterLabel: string;
  deleteVolumeLabel: string;
  editMetaLabel: string;
  prefaceLabel: string;
  dragLabel: string;
  registerEl: (el: HTMLElement | null) => void;
  onToggle: () => void;
  onOpenCurrentChapter: () => void;
  onAddChapter: () => void;
  onEditMeta: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: NODE_PREFIX + volume.id,
    data: { type: "volume", nodeId: volume.id },
  });

  const containsSelectedChapter = isCollapsed && currentChapterTitle !== null;
  const preface = volume.preface.trim();
  const hasPreface = Boolean(preface);
  const row = (
    <div
      ref={(el) => {
        setNodeRef(el);
        registerEl(el);
      }}
      style={{
        transform: sessionActive
          ? CSS.Transform.toString(transform)
          : undefined,
        transition: sessionActive ? transition : undefined,
      }}
      className={[
        "group hover:bg-accent/40 relative flex items-center gap-1 rounded-md border px-2 py-1 transition-colors",
        containsSelectedChapter
          ? "chapter-row-selected bg-accent/25 text-accent-foreground before:pointer-events-none before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-[var(--editor-selection-border)]"
          : "border-transparent",
        isDragging || dragging ? "opacity-40" : "",
      ].join(" ")}
      {...attributes}
    >
      <span
        {...listeners}
        aria-label={dragLabel}
        title={dragLabel}
        className="text-muted-foreground/30 hover:text-muted-foreground/70 focus-visible:text-muted-foreground/70 flex size-4 shrink-0 cursor-grab items-center justify-center transition-colors active:cursor-grabbing"
      >
        <GripVertical className="size-3" />
      </span>
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <ChevronRight
          className={[
            "icon-sm shrink-0 transition-transform",
            containsSelectedChapter
              ? "text-[var(--editor-selection-border)]"
              : "text-muted-foreground",
            isCollapsed ? "" : "rotate-90",
          ].join(" ")}
        />
        <span className="min-w-0 truncate text-sm font-medium">
          {volume.title}
        </span>
        {hasPreface ? (
          <span
            className="text-muted-foreground/60 flex shrink-0 items-center"
            aria-label={prefaceLabel}
            title={prefaceLabel}
          >
            <FileText className="size-3" />
          </span>
        ) : null}
        {/*
         * 章数跟在名称后面而不是推到最右：名称与数量是同一条信息
         * （"这卷有多少章"），推到右侧会被两端的操作按钮挤远，
         * 视线要来回扫才联系得上。
         */}
        <span
          className={[
            "shrink-0 text-xs tabular-nums",
            containsSelectedChapter
              ? "text-[var(--editor-selection-border)]"
              : "text-muted-foreground/60",
          ].join(" ")}
        >
          {chapterCount}
        </span>
      </button>
      <button
        type="button"
        onClick={onEditMeta}
        className="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={editMetaLabel}
        title={editMetaLabel}
      >
        <Settings2 className="icon-sm" />
      </button>
      <button
        type="button"
        onClick={onAddChapter}
        className="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={addChapterLabel}
      >
        <Plus className="icon-sm" />
      </button>
      {/* 删卷：与加章同排，悬停卷行时出现。 */}
      <button
        type="button"
        onClick={onDelete}
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={deleteVolumeLabel}
        title={deleteVolumeLabel}
      >
        <Trash2 className="icon-sm" />
      </button>
    </div>
  );

  if (!hasPreface && (!containsSelectedChapter || !currentChapterTitle)) {
    return row;
  }

  return (
    <HoverCard openDelay={450} closeDelay={140}>
      <HoverCardTrigger asChild>{row}</HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-72 p-3"
      >
        {hasPreface ? (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="text-muted-foreground size-3.5 shrink-0" />
              <span className="text-muted-foreground shrink-0 text-[10px]">
                {prefaceLabel}
              </span>
              <span className="min-w-0 truncate text-sm font-medium">
                {volume.title}
              </span>
            </div>
            <p className="scrollbar-app text-muted-foreground max-h-56 overflow-y-auto text-xs leading-relaxed break-words whitespace-pre-wrap">
              {preface}
            </p>
          </div>
        ) : null}
        {containsSelectedChapter && currentChapterTitle ? (
          <div
            className={
              hasPreface ? "mt-3 border-t pt-3" : "flex flex-col gap-2"
            }
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="bg-accent text-accent-foreground shrink-0 rounded-sm border border-[var(--editor-selection-border)] px-1.5 py-0.5 text-[10px] font-medium">
                {currentLabel}
              </span>
              <span className="min-w-0 truncate text-sm font-medium">
                {currentChapterTitle}
              </span>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2 h-7 w-full justify-between px-2 text-xs"
              onClick={onOpenCurrentChapter}
            >
              {openCurrentLabel}
              <ArrowUpRight className="icon-sm" />
            </Button>
          </div>
        ) : null}
      </HoverCardContent>
    </HoverCard>
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
        dragging && isOver ? "bg-accent/50 ring-primary rounded-md ring-1" : "",
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
  onSelectChapter,
  onCreateChapter,
  onCreateVolume,
  onMoveNode,
  onUpdateNode,
  onDeleteVolume,
}: OutlinePaneProps) {
  const { t } = useI18n();
  /*
   * 高亮读 readingChapterId 而不是 currentChapterId。
   *
   * 连续章节流里往下滚过第 3 章时，用户可能还在写第 2 章——阅读位置
   * 与编辑目标本来就会短暂分叉。高亮要回答的是"我在读哪一章"，
   * 用编辑目标会让用户觉得点错了地方。
   */
  const {
    chapters,
    volumes,
    chapterMetas,
    currentChapterId,
    readingChapterId,
  } = useOutline();
  const { currentWorkId } = useLibrary();

  /** 新建卷对话框。 */
  const [volumeDialog, setVolumeDialog] = useState(false);
  const [collapsedByWork, setCollapsedByWork] = useLocalStorageState<
    Record<string, Record<string, boolean>>
  >(VOLUME_COLLAPSE_KEY, { defaultValue: {} });
  const collapsed = currentWorkId
    ? (collapsedByWork?.[currentWorkId] ?? {})
    : {};
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const setCollapsed = useCallback(
    (next: SetStateAction<Record<string, boolean>>) => {
      if (!currentWorkId) return;
      setCollapsedByWork((previous) => {
        const all = previous ?? {};
        const current = all[currentWorkId] ?? {};
        const value = typeof next === "function" ? next(current) : next;
        if (value === current) return all;
        return { ...all, [currentWorkId]: value };
      });
    },
    [currentWorkId, setCollapsedByWork]
  );
  /** 新建章节对话框的目标父级，undefined 表示未打开。 */
  const [chapterDialogIn, setChapterDialogIn] = useState<
    string | null | undefined
  >(undefined);
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

  /** 章与卷的统一索引：拖拽解析父级时要能查到两者。 */
  const nodeById = useMemo(
    () => new Map([...chapters, ...volumes].map((n) => [n.id, n])),
    [chapters, volumes]
  );
  /** 当前阅读章；卷收起时用它的标题组成跳转 HoverCard。 */
  const selectedChapter = useMemo(() => {
    if (!readingChapterId) return null;
    const selected = nodeById.get(readingChapterId);
    return selected?.type === "chapter" ? selected : null;
  }, [nodeById, readingChapterId]);
  const allVolumesCollapsed =
    volumes.length > 0 &&
    volumes.every((volume) => Boolean(collapsed[volume.id]));
  /** 章节点 DOM：位置法算插入下标时要读实时矩形。 */
  const nodeEls = useRef(new Map<string, HTMLElement>());
  const { highlightId, jumpTo } = useJumpHighlight("data-outline-chapter");

  /* 外部跳章时，左栏选中项必须滚进视野；顺手展开所在卷。 */
  useEffect(() => {
    if (!currentChapterId) return;
    const node = nodeById.get(currentChapterId);
    if (node?.type !== "chapter") return;
    const parentVolumeId = node.parentId;
    if (parentVolumeId && collapsedRef.current[parentVolumeId]) {
      setCollapsed((previous) => ({
        ...previous,
        [parentVolumeId]: false,
      }));
    }
    jumpTo(currentChapterId);
  }, [currentChapterId, jumpTo, nodeById, setCollapsed]);
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

  const activeNode = activeId
    ? (nodeById.get(activeId.slice(NODE_PREFIX.length)) ?? null)
    : null;
  /** 命中具体节点时抑制容器高亮，避免同时亮两处。 */
  const overRef = overId ? parseDroppableId(overId) : null;

  /**
   * 被拖节点的同级序列，按 order 排好。
   *
   * 必须与 `services/outline.ts` 的 `moveNode` 取同级的口径完全一致，
   * 否则算出的 targetIndex 落在另一个索引空间里，顺序看起来不动。
   *
   * 关键：卷与游离章的 parentId 都是 null，共享**同一个** order 序列
   * ——它们在数据上是混在一起的，不存在"卷的序列"这种东西。
   * 所以顶层要取「卷 + 游离章」合并后的有序列表，不能只取卷。
   * （曾经只取卷，于是顶层有 2 卷 2 游离章时，把末卷拖到底算出的
   * index 是卷内下标，moveNode 却按 4 个顶层节点解释，永远插不对。）
   *
   * 只有卷内才需要按类型过滤：那下面的同级必然全是章。
   */
  const siblingsOf = useCallback(
    (node: OutlineNode): OutlineNode[] => {
      const sameParent =
        node.parentId === null
          ? [
              ...volumes.filter((v) => v.parentId === null),
              ...(chaptersByVolume.get(null) ?? []),
            ]
          : (chaptersByVolume.get(node.parentId) ?? []);
      return [...sameParent].sort((a, b) => a.order - b.order);
    },
    [volumes, chaptersByVolume]
  );

  /**
   * 目标父级下的同级序列，口径同样要对齐 moveNode。
   *
   * 跨父级移动时，moveNode 的 toSide 是「目标父级下、已按 order 排好、
   * 且不含被拖节点」的列表。顶层同样要把卷与游离章合并——空卷的列表
   * 是空的，此时落点只能是 0（追加进去），这正是期望行为。
   */
  const siblingsOfTarget = useCallback(
    (targetParentId: string | null): OutlineNode[] => {
      if (targetParentId !== null)
        return chaptersByVolume.get(targetParentId) ?? [];
      return [
        ...volumes.filter((v) => v.parentId === null),
        ...(chaptersByVolume.get(null) ?? []),
      ].sort((a, b) => a.order - b.order);
    },
    [volumes, chaptersByVolume]
  );

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
    const activeEl = nodeEls.current.get(
      String(e.active.id).slice(NODE_PREFIX.length)
    );
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
    const landedParent =
      ref?.kind === "into"
        ? ref.parentId
        : ref
          ? (nodeById.get(ref.nodeId)?.parentId ?? source.parentId)
          : source.parentId;

    /*
     * 卷不参与"拖进别的卷"这种玩法：章节能降级到卷里，卷再往下钻
     * 没有对应的界面与语义（卷里不会再有卷）。这里把卷的目标父级钉死
     * 在顶层，只允许它与其它顶层卷换位。
     */
    const targetParentId =
      source.type === "volume" ? source.parentId : landedParent;

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
    /*
     * 下标必须在「目标父级」的空间里算，与 moveNode 的两个分支对齐：
     * - 同父级换位：moveNode 取 source 侧的兄弟（已剔除自己）。
     * - 跨父级：moveNode 取 target 侧的兄弟（不含自己，因为它还在源侧）。
     *
     * 之前统一用 `siblingsOf(source)`，于是"把游离章拖进空卷"时
     * 拿到的是顶层列表（2 卷 + 2 游离章），算出的下标落在顶层空间；
     * 而 moveNode ��空卷的 toSide 是空数组，下标被 clamp 到 0 ——
     * 章本该进卷，最后却仍留在顶层（或落到别的位置），表现为"拖不进去"。
     */
    const siblings =
      source.parentId === targetParentId
        ? siblingsOf(source)
        : siblingsOfTarget(targetParentId);
    const centers: number[] = [];
    for (const n of siblings) {
      if (n.id === nodeId) continue;
      const center = snap.centers.get(n.id);
      if (center === undefined) continue;
      centers.push(center);
    }
    const draggedCenter = snap.pointerY + e.delta.y;
    const index = computeIndexByPosition(centers, draggedCenter);
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
      log.warn("[outline-dnd] abort: index out of range", {
        index,
        len: without.length,
      });
      return;
    }
    const before = siblings.map((n) => n.id).join(",");
    const after = [
      ...without.slice(0, index),
      { id: nodeId },
      ...without.slice(index),
    ]
      .map((n) => n.id)
      .join(",");
    if (before === after) {
      log.warn("[outline-dnd] abort: order unchanged", { index });
      return;
    }
    log.debug("[outline-dnd] committing move", {
      nodeId,
      targetParentId,
      index,
    });
    void onMoveNode(nodeId, targetParentId, index);
    layoutAtStart.current = null;
  }

  /* ---------- 章节详情 ---------- */

  /**
   * 顶层的一条有序序列：卷与游离章按 order 交错。
   *
   * 之前是「先渲染所有卷，再渲染所有游离章」两段。数据上两者共享同一个
   * order 序列，渲染却拆开了，于是几何顺序表达不了数据顺序——
   * 用户想把末卷拖到游离章下面，视觉上却没有任何位置能表示
   * "这一卷排在这些游离章之后"，怎么拖都到不了底。
   *
   * 交错渲染后，几何顺序与 order 一致，落点算出的下标才有意义。
   */
  const topLevel = useMemo(() => {
    const loose = chaptersByVolume.get(null) ?? [];
    const byOrder = new Map<string, number>();
    for (const n of [...volumes, ...loose]) byOrder.set(n.id, n.order);
    /* order 可能因历史操作留下重复，用 id 做稳定的次级排序键。 */
    return [...volumes, ...loose].sort(
      (a, b) => (byOrder.get(a.id) ?? 0) - (byOrder.get(b.id) ?? 0)
    );
  }, [volumes, chaptersByVolume]);

  /** 游离章单独编号；卷不是章，不能占用顶层章序。 */
  const topLevelChapterIndexes = useMemo(() => {
    const indexes = new Map<string, number>();
    let next = 0;
    for (const item of topLevel) {
      if (item.type === "chapter") indexes.set(item.id, next++);
    }
    return indexes;
  }, [topLevel]);

  function renderChapterList(
    parentId: string | null,
    explicit?: OutlineNode[],
    startIndex = 0
  ) {
    const list = explicit ?? chaptersByVolume.get(parentId) ?? [];
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
              index={startIndex + i}
              selected={readingChapterId === node.id}
              highlighted={highlightId === node.id}
              dragging={activeId === NODE_PREFIX + node.id}
              sessionActive={Boolean(activeId)}
              onSelect={() => onSelectChapter(node.id)}
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
                updated: relativeTime(
                  chapterMetas[metaTarget.id].updatedAt,
                  now
                ),
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
        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={volumes.length === 0}
            aria-label={
              allVolumesCollapsed
                ? t("Editor.volume.expandAll")
                : t("Editor.volume.collapseAll")
            }
            title={
              allVolumesCollapsed
                ? t("Editor.volume.expandAll")
                : t("Editor.volume.collapseAll")
            }
            onClick={() =>
              setCollapsed(
                allVolumesCollapsed
                  ? {}
                  : Object.fromEntries(
                      volumes.map((volume) => [volume.id, true])
                    )
              )
            }
          >
            {allVolumesCollapsed ? (
              <ChevronsUpDown className="icon-sm" />
            ) : (
              <ChevronsDownUp className="icon-sm" />
            )}
          </Button>
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
            {/*
             * 顶层按 order 交错渲染：卷与游离章是同一条序列上的元素。
             * SortableContext 只覆盖顶层（卷 + 游离章），卷内的章由
             * renderChapterList 自己的 SortableContext 接管，互不干扰。
             */}
            <SortableContext
              items={topLevel.map((n) => NODE_PREFIX + n.id)}
              strategy={verticalListSortingStrategy}
            >
              {topLevel.map((item, i) => {
                /*
                 * 分割线：卷之前、以及"卷后面紧跟的游离章"之前画。
                 * 顶层首项不画——顶边紧贴面板上沿，画线像被裁掉半截的边框。
                 * 游离章之间不画线，它们是连续的一张列表。
                 */
                const prev = topLevel[i - 1];
                const needsDivider =
                  i > 0 &&
                  (item.type === "volume" ||
                    (item.type === "chapter" && prev?.type === "volume"));

                if (item.type === "chapter") {
                  return (
                    <div key={item.id}>
                      {needsDivider ? (
                        <div
                          className="bg-border/70 mx-2 my-2 h-px"
                          aria-hidden="true"
                        />
                      ) : null}
                      <div className="mt-0.5 flex flex-col gap-0.5">
                        {renderChapterList(
                          null,
                          [item],
                          topLevelChapterIndexes.get(item.id) ?? 0
                        )}
                      </div>
                    </div>
                  );
                }

                const volume = item;
                const isCollapsed = collapsed[volume.id];
                return (
                  <DropZone
                    key={volume.id}
                    parentId={volume.id}
                    dragging={Boolean(activeId) && overRef?.kind !== "before"}
                    className="mb-1"
                  >
                    {needsDivider ? (
                      <div
                        className="bg-border/70 mx-2 my-2 h-px"
                        aria-hidden="true"
                      />
                    ) : null}
                    <VolumeRow
                      volume={volume}
                      isCollapsed={isCollapsed}
                      currentChapterTitle={
                        selectedChapter?.parentId === volume.id
                          ? selectedChapter.title
                          : null
                      }
                      sessionActive={Boolean(activeId)}
                      dragging={activeId === NODE_PREFIX + volume.id}
                      chapterCount={
                        (chaptersByVolume.get(volume.id) ?? []).length
                      }
                      currentLabel={t("Editor.side.current")}
                      openCurrentLabel={t("Editor.volume.openCurrent")}
                      addChapterLabel={t("Editor.side.addChapter")}
                      deleteVolumeLabel={t("Editor.volume.delete")}
                      editMetaLabel={t("Editor.node.editMeta")}
                      prefaceLabel={t("Editor.node.preface")}
                      dragLabel={t("Editor.node.dragHint")}
                      registerEl={(el) => {
                        if (el) nodeEls.current.set(volume.id, el);
                        else nodeEls.current.delete(volume.id);
                      }}
                      onToggle={() =>
                        setCollapsed((prev) => ({
                          ...prev,
                          [volume.id]: !prev[volume.id],
                        }))
                      }
                      onOpenCurrentChapter={() => {
                        setCollapsed((prev) => ({
                          ...prev,
                          [volume.id]: false,
                        }));
                        if (selectedChapter) {
                          onSelectChapter(selectedChapter.id);
                        }
                      }}
                      onAddChapter={() => setChapterDialogIn(volume.id)}
                      onEditMeta={() => setMetaTarget(volume)}
                      onDelete={() => onDeleteVolume(volume.id)}
                    />

                    {!isCollapsed ? renderChapterList(volume.id) : null}
                  </DropZone>
                );
              })}
            </SortableContext>

            {/*
             * 根层拖放区：把章从卷里拖出来必须有落点，
             * 否则"移出到顶层"这个动作在界面上无法完成。
             *
             * 这里只提供落点提示，不再渲染游离章本身——那些章已作为
             * topLevel 的成员交错渲染在上面，重复渲染会让同一章出现两次。
             * 拖拽进行中才显示虚线框，避免平时占掉空白处。
             */}
            <DropZone
              parentId={null}
              dragging={Boolean(activeId) && overRef?.kind !== "before"}
              className={
                activeId
                  ? "border-border/60 mt-1 rounded-md border border-dashed p-1"
                  : ""
              }
            >
              {/*
               * 提示文字只在指针真的落在这个区域时才出现。
               *
               * 之前是"只要在拖拽就渲染"，于是把游离章往卷里拖时，
               * 底下这行"移到顶层"还杵着——它描述的是把章拖**出**卷的动作，
               * 而用户此刻的目标是把章拖**进**卷，语义正好相反。
               *
               * 文案也随来源节点变化：从卷里往外拖才是"移到顶层"，
               * 已经游离的章再拖回顶层没有意义（本来就在那）。
               */}
              {activeId &&
              overRef?.kind === "into" &&
              overRef.parentId === null &&
              /* 已经在顶层的章拖回顶层没有意义，别给一个假动作发提示。 */
              activeNode?.parentId !== null ? (
                <p className="text-muted-foreground/60 px-1 py-1 text-center text-xs">
                  {t("Editor.node.moveOut")}
                </p>
              ) : null}
            </DropZone>

            {!volumes.length && !chapters.length ? (
              <div className="px-2 py-6 text-center">
                <p className="text-muted-foreground text-xs">
                  {t("Editor.side.emptyWork")}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* dropAnimation 置空：浮层默认会飞回落点，我们已落盘重排，无需这层回落动画。 */}
        <DragOverlay dropAnimation={null}>
          {activeNode ? (
            <div className="bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-sm shadow-lg">
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
