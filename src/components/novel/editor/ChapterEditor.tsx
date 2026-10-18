import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, Loader2, Pencil, Save, Trash2, Undo2 } from "lucide-react";
import { useLocalStorageState } from "ahooks";

import { Button } from "@/components/ui/button";
import CardItem from "./CardItem";
import ComposerInput, { type ComposerHandle } from "./ComposerInput";
import SplitDialog from "./SplitDialog";

import { useI18n } from "@/composables";
import { useToast } from "@/composables";
import { useViewMode } from "@/contexts/viewmode";
import { createLogger } from "@/lib/logger";
import { CommandHistory } from "@/lib/command-history";
import { cardsToText, countWords, saveChapter } from "@/services/chapter";
import { cardSchema, type Card, type Chapter } from "@/shared/schema";

const log = createLogger("ChapterEditor");

export interface ChapterEditorProps {
  chapter: Chapter;
  /** 工作区根与作品 id，落盘时需要。 */
  root: string;
  workId: string;
  /** 章内容变化后通知父级（用于更新字数统计）。 */
  onWordsChange?: (words: number) => void;
  /** 章保存后通知父级（用于同步 outline 状态）。 */
  onSaved?: (chapter: Chapter) => void;
  /**
   * 章保存后上报本章字数（用于作品库的字数统计）。
   * 传全量而非增量，避免重载 / 修数据后统计越漂越远。
   */
  onWordsCommitted?: (chapterWords: number) => void;
  /**
   * 章级操作入口：重命名与删除。
   *
   * 由父级（Editor）实现并传入，因此标题栏只负责呈现，
   * 章文件与结构树的双写逻辑仍留在 Editor 一处。
   */
  onRename?: () => void;
  onDelete?: () => void;
}

/** 防抖自动保存间隔（计划书 §6.3：800ms）。 */
const AUTOSAVE_DELAY = 800;

type SaveState = "saved" | "dirty" | "saving";

/**
 * 段末句读：用于判断"这一段是否已经写完"。
 * 只认真正收束语义的标点，逗号顿号这类停顿符不算。
 */
const TERMINATORS = new Set([
  "。", "！", "？", "…", "）", "】", "》", "」", "』", "〉",
  "”", "’", ".", "!", "?", "…", ")", "]", "}", '"', "'",
]);

/** 该段是否以句读收束。 */
function isTerminated(text: string): boolean {
  const trimmed = text.trimEnd();
  if (!trimmed) return false;
  return TERMINATORS.has(Array.from(trimmed).at(-1) ?? "");
}

/** 上一次合并的信息，供"撤回合并"使用。 */
interface LastMerge {
  /** 合并后主卡所在下标。 */
  index: number;
  /** 合并前主卡的文本。 */
  text: string;
  /** 被并进来的那张卡的 id 与文本。 */
  removedId: string;
  removedText: string;
}

/**
 * 章内容编辑器：卡片列表 + 底部唯一输入框。
 *
 * 数据流（计划书 §6.3）：
 *   输入框(ref 读取，不进 state) → 回车提交为卡片 → 记入命令历史
 *   → 防抖 800ms → services/chapter.save() → 同时写 json 与 txt 视图
 *
 * 卡片数组刻意整章放在 state 里但更新走"整章新数组"，
 * 因为结构操作（重排/删除/拆分/合并）本身就是整章级变更；
 * 高亮等重计算只发生在单卡上，不依赖整章 diff。
 */
export default function ChapterEditor({
  chapter,
  root,
  workId,
  onWordsChange,
  onSaved,
  onWordsCommitted,
  onRename,
  onDelete,
}: ChapterEditorProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { mode } = useViewMode();

  const [cards, setCards] = useState<Card[]>(chapter.cards);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [splitTarget, setSplitTarget] = useState<number | null>(null);
  /** 上一次合并，用于"撤回合并"按钮。 */
  const [lastMerge, setLastMerge] = useState<LastMerge | null>(null);
  /**
   * 暂存的新段落。
   *
   * 写新段落时点开一张旧卡片，原来输入框里的草稿会被卡片的原文覆盖，
   * 于是"刚写的那段"凭空丢了。这里把草稿扣下来，贴在编辑区上方。
   *
   * 按作品 + 章分别存进 localStorage：只落浏览器，不进工作区目录。
   * 正文是有版本意义的创作成果，草稿只是没写完的半成品，
   * 混进 works/<id>/ 会污染用户导出的文本；崩了也只丢一次半成品。
   * 按章隔离，切回来还能接着写。
   */
  const [draft, setDraftRaw] = useLocalStorageState<string | null>(
    `novels-yes:draft:${workId}:${chapter.id}`,
    { defaultValue: null }
  );
  /** draft 的 ref 副本：回调里读最新值，不必把 draft 塞进依赖。 */
  const draftRef = useRef<string | null>(draft);

  /** 统一写入口，保证 ref 与 localStorage 同步。 */
  const setDraft = useCallback(
    (value: string | null) => {
      draftRef.current = value;
      setDraftRaw(value);
    },
    [setDraftRaw]
  );

  const composerRef = useRef<ComposerHandle | null>(null);
  const historyRef = useRef<CommandHistory<Card[]> | null>(null);
  const saveTimer = useRef<number | null>(null);
  /** 待保存的最新卡片数组，卸载时 flush 用。 */
  const pendingCards = useRef<Card[] | null>(null);

  /** 真正执行落盘。 */
  const persistNow = useCallback(
    async (nextCards: Card[]) => {
      setSaveState("saving");
      try {
        const next: Chapter = {
          ...chapterRef.current,
          cards: nextCards,
          cursor: { cardIndex: editingIndexRef.current, offset: 0 },
        };
        await saveChapter(root, workId, next);
        /*
         * 作品库的字数来自 stats.json。作品总字数是全书各章之和，
         * 由父级汇总后写入——单章字数不等于作品字数，这里只上报本章。
         */
        onWordsCommitted?.(countWords(cardsToText(nextCards)));
        pendingCards.current = null;
        setSaveState("saved");
        onSaved?.(next);
        log.debug("chapter saved", { cards: nextCards.length });
      } catch (err) {
        log.error("save failed", err);
        setSaveState("dirty");
        toast.error("Editor.save.failed");
      }
    },
    [root, workId, onSaved, onWordsCommitted, toast]
  );

  /* 切章时重置：卡片、编辑态、历史栈。依赖 chapter.id 而非 chapter，
     否则父级回传保存结果会触发重置，把本地编辑态冲掉。 */
  const chapterId = chapter.id;
  const initialCards = chapter.cards;
  useEffect(() => {
    setCards(initialCards);
    setEditingIndex(-1);
    setSaveState("saved");
    pendingCards.current = null;
    /*
     * 草稿按章存在 localStorage 里，切章不动它——
     * 切回来时还要接着写。这也是 localStorage 相对组件 state 的唯一理由。
     */
    historyRef.current = new CommandHistory<Card[]>(initialCards);
    composerRef.current?.clear();
    /*
     * 切到已有章节后直接进入可写作状态：把焦点交给底部输入框，
     * 用户不必先去点某张卡片才能落笔。
     */
    requestAnimationFrame(() => composerRef.current?.focus("end"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);

  /* 字数统计：仅在卡片数组变化时重算（中文输入组合期不会触发，因为内容不进 state）。 */
  const words = useMemo(() => countWords(cardsToText(cards)), [cards]);
  useEffect(() => {
    onWordsChange?.(words);
  }, [words, onWordsChange]);

  /**
   * 打字机模式：把活动卡片滚到视口舒适线。
   *
   * 只在"活动卡片变了"时滚一次，而不是每次渲染都滚——否则用户
   * 手动往上翻看前文时会被立刻拽回来。
   */
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (mode !== "typewriter") return;
    if (editingIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-card-index="${editingIndex}"]`
    );
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [mode, editingIndex]);

  /*
   * 专注模式下压暗非当前卡片。
   *
   * 只在"正在编辑某张卡"时压暗：追加新段时没有活动卡片，
   * 若此时也压暗，用户会以为整页坏了。
   */
  const dimOthers = mode === "focus" && editingIndex >= 0;

  /** 提交保存：防抖 800ms 后落盘。 */
  const scheduleSave = useCallback(
    (nextCards: Card[]) => {
      pendingCards.current = nextCards;
      setSaveState("dirty");
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void persistNow(nextCards);
      }, AUTOSAVE_DELAY);
    },
    [persistNow]
  );

  /** chapter 的 ref 副本，避免 persistNow 随每次保存重建。 */
  const chapterRef = useRef(chapter);
  useEffect(() => {
    chapterRef.current = chapter;
  }, [chapter]);

  /* editingIndex 的 ref 副本，供防抖回调读取最新值而不重建定时器。 */
  const editingIndexRef = useRef(-1);
  useEffect(() => {
    editingIndexRef.current = editingIndex;
  }, [editingIndex]);

  /** 统一的卡片变更入口：更新 state、记历史、排保存。 */
  const applyCards = useCallback(
    (next: Card[], record = true) => {
      setCards(next);
      if (record) historyRef.current?.record(next);
      scheduleSave(next);
    },
    [scheduleSave]
  );

  /**
   * 手动保存：按钮任何时候都可点，落什么由保存函数自己判断。
   *
   * 不做"是否有未保存内容"的前置判断——防抖窗口内点击、或上次保存失败后
   * 重试，都必须能真正写一次盘。没有待写内容时以当前卡片为准。
   */
  const saveNow = useCallback(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    void persistNow(pendingCards.current ?? cardsRef.current);
  }, [persistNow]);

  /* ---------- 卡片操作 ---------- */

  /* ---------- 撤销 / 重做 ----------
     放在合并操作之前：撤回合并在结构对不上时会退回到通用撤销。 */
  const undo = useCallback(() => {
    const prev = historyRef.current?.undo();
    if (!prev) return;
    setCards(prev);
    scheduleSave(prev);
  }, [scheduleSave]);

  const redo = useCallback(() => {
    const next = historyRef.current?.redo();
    if (!next) return;
    setCards(next);
    scheduleSave(next);
  }, [scheduleSave]);

  /** 回车提交：editingIndex 为 -1 新建，否则更新该卡。 */
  const handleSubmit = useCallback(
    (text: string, index: number) => {
      const now = Date.now();
      if (index < 0) {
        const card: Card = cardSchema.parse({
          id: crypto.randomUUID(),
          text,
          createdAt: now,
          updatedAt: now,
        });
        applyCards([...cards, card]);
      } else {
        const next = cards.map((c, i) =>
          i === index ? cardSchema.parse({ ...c, text, updatedAt: now }) : c
        );
        applyCards(next);
      }

      /*
       * 草稿只在"提交的就是它自己"时才作废。
       *
       * 携带暂存草稿去改旧段落时，index >= 0，提交的是那张卡的文本，
       * 草稿本身还没写进去——此时必须把它放回输入框，否则刚写的那段
       * 就在提交的一瞬间被清掉了。
       */
      const stashed = draftRef.current;
      if (index >= 0 && stashed) {
        /*
         * 提交旧卡后回到追加模式，并把暂存段落放回输入框。
         * 草稿此时"回到"了编辑框，因此上面的暂存卡片同步撤掉，
         * 否则同一段文字会同时出现在卡片和输入框里。
         */
        setDraft(null);
        setEditingIndex(-1);
        requestAnimationFrame(() => composerRef.current?.load(stashed, "end", true));
        return;
      }

      setDraft(null);
      setEditingIndex(-1);
    },
    [cards, applyCards, setDraft]
  );

  /** 点击卡片：载入输入框编辑。 */
  const handleCardClick = useCallback((index: number) => {
    /*
     * 正在写新段落时点开旧卡片，先把草稿暂存起来。
     * load() 会覆盖 textarea.value，若不扣下草稿就直接被冲掉了。
     * 已经在编辑某张卡时则不暂存——那时输入框里的内容属于那张卡。
     */
    if (editingIndexRef.current < 0) {
      const pending = composerRef.current?.read().trim() ?? "";
      if (pending) {
        setDraft(pending);
      }
    }
    setEditingIndex(index);
    // 下一帧再 focus，确保 textarea 已渲染出 editing 提示。
    requestAnimationFrame(() => {
      const card = cardsRef.current[index];
      if (card) composerRef.current?.load(card.text, "end");
    });
  }, [setDraft]);

  /**
   * 从"编辑已有卡片"退回"接着写新段落"。
   *
   * 输入框里此时可能已经打了字但没提交。这里不丢弃：先把内容交还给原卡片
   * （与正常提交一致），再清空输入框回到追加模式。这样"回车"和"点返回"
   * 两种放弃方式行为一致，不会静默吃掉用户输入。
   */
  const returnToNew = useCallback(() => {
    const index = editingIndexRef.current;
    const typed = composerRef.current?.read().trim() ?? "";
    if (index >= 0 && typed) {
      const now = Date.now();
      const next = cardsRef.current.map((c, i) =>
        i === index ? cardSchema.parse({ ...c, text: typed, updatedAt: now }) : c
      );
      setCards(next);
      historyRef.current?.record(next);
      scheduleSave(next);
    }
    /*
     * 回到追加模式：若先前暂存过新段落，一并取回输入框。
     * 否则会出现"点了回到最新段落，草稿却还孤零零挂在上面"的错位。
     */
    const stashed = draftRef.current;
    setDraft(null);
    setEditingIndex(-1);
    composerRef.current?.clear();
    requestAnimationFrame(() => composerRef.current?.load(stashed ?? "", "end", Boolean(stashed)));
  }, [scheduleSave, setDraft]);

  /** 取回暂存段落：清空输入框回到追加模式，并把草稿放回去。 */
  const restoreDraft = useCallback(() => {
    setEditingIndex(-1);
    const text = draft ?? "";
    setDraft(null);
    requestAnimationFrame(() => composerRef.current?.load(text, "end", true));
  }, [draft, setDraft]);

  /** 丢弃暂存段落。 */
  const discardDraft = useCallback(() => setDraft(null), [setDraft]);

  /* cards 的 ref 副本，供回调读取最新值。 */
  const cardsRef = useRef(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  /** 上移：与前一张交换。 */
  const moveUp = useCallback(
    (index: number) => {
      if (index <= 0) return;
      const next = [...cards];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      applyCards(next);
    },
    [cards, applyCards]
  );

  /** 下移：与后一张交换。 */
  const moveDown = useCallback(
    (index: number) => {
      if (index >= cards.length - 1) return;
      const next = [...cards];
      [next[index + 1], next[index]] = [next[index], next[index + 1]];
      applyCards(next);
    },
    [cards, applyCards]
  );

  /** 拆分：在光标处把一张卡分成两张。 */
  const splitCard = useCallback(
    (index: number) => {
      if (!cards[index]?.text.trim()) return;
      setSplitTarget(index);
    },
    [cards]
  );

  /** 在指定偏移处真正执行拆分。 */
  const confirmSplit = useCallback(
    (offset: number) => {
      const index = splitTarget;
      if (index === null) return;
      const card = cards[index];
      if (!card) return;
      const head = card.text.slice(0, offset).trim();
      const tail = card.text.slice(offset).trim();
      if (!head || !tail) return;
      const now = Date.now();
      const nextCard: Card = cardSchema.parse({
        id: crypto.randomUUID(),
        text: tail,
        createdAt: now,
        updatedAt: now,
      });
      const next = [
        ...cards.slice(0, index),
        { ...card, text: head, updatedAt: now },
        nextCard,
        ...cards.slice(index + 1),
      ];
      applyCards(next);
    },
    [cards, splitTarget, applyCards]
  );

  /**
   * 合并：当前卡与下一张合并为一张。
   *
   * 合并只在"上一段确实写完了"时才合理——段末没有句读说明话还没说完，
   * 硬拼起来会变成一段没有内部停顿的长句。因此先检查段末标点，
   * 不满足时给出提示而不是默默合并。
   */
  const mergeDown = useCallback(
    (index: number) => {
      if (index >= cards.length - 1) return;
      const head = cards[index].text.trimEnd();
      if (!isTerminated(head)) {
        toast.warning("Editor.card.mergeUnfinished");
        return;
      }
      /* 段末标点与下一段开头之间不再插入换行：既然是同段，标点后就该接续。 */
      const merged = `${head}${cards[index + 1].text}`;
      const next = [
        ...cards.slice(0, index),
        { ...cards[index], text: merged, updatedAt: Date.now() },
        ...cards.slice(index + 2),
      ];
      applyCards(next);
      /* 记住这次合并，便于一键撤回（撤销栈也会记，但撤回入口更直接）。 */
      setLastMerge({
        index,
        text: head,
        removedId: cards[index + 1].id,
        removedText: cards[index + 1].text,
      });
    },
    [cards, applyCards, toast]
  );

  /** 撤回上一次的合并：把被并进来的那张卡还原成独立一张。 */
  const undoMerge = useCallback(() => {
    const merge = lastMerge;
    if (!merge) return;
    /* 内容可能已经被再次编辑过，结构对不上时交给通用撤销处理。 */
    const current = cards[merge.index];
    if (!current || !current.text.includes(merge.removedText)) {
      setLastMerge(null);
      undo();
      return;
    }
    const restored: Card = cardSchema.parse({
      id: merge.removedId,
      text: merge.removedText,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    });
    const next = [
      ...cards.slice(0, merge.index),
      { ...current, text: merge.text },
      restored,
      ...cards.slice(merge.index + 1),
    ];
    applyCards(next);
    setLastMerge(null);
  }, [lastMerge, cards, applyCards, undo]);

  /** 删除一张卡。 */
  const deleteCard = useCallback(
    (index: number) => {
      applyCards(cards.filter((_, i) => i !== index));
      if (editingIndexRef.current === index) {
        setEditingIndex(-1);
        composerRef.current?.clear();
      } else if (editingIndexRef.current > index) {
        setEditingIndex(editingIndexRef.current - 1);
      }
    },
    [cards, applyCards]
  );

  /* 全局快捷键：Ctrl+Z / Ctrl+Shift+Z。输入框内让位给原生 undo。 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const inTextarea = (e.target as HTMLElement)?.tagName === "TEXTAREA";
      if (inTextarea) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  /*
   * 卸载时冲刷待保存内容。
   *
   * 这是数据可靠性的关键点：ChapterEditor 以 chapter.id 为 key，切换章节或
   * 返回作品库都会立刻卸载本组件。仅 clearTimeout 会把防抖窗口内固化的
   * 卡片直接丢掉——用户看到的是"已保存"，退出再进来却空章。
 */
  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const cards = pendingCards.current;
      if (cards) void persistNow(cards);
    };
  }, [persistNow]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SplitDialog
        open={splitTarget !== null}
        cardIndex={splitTarget ?? -1}
        text={splitTarget !== null ? (cards[splitTarget]?.text ?? "") : ""}
        onOpenChange={(o) => {
          if (!o) setSplitTarget(null);
        }}
        onConfirm={confirmSplit}
      />

      {/* 章标题区 */}
      <header className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="icon-md shrink-0 text-muted-foreground" />
          <h2 className="truncate text-base font-semibold">
            {chapter.title || t("Editor.title.placeholder")}
          </h2>
          {/*
           * 章级操作放在标题栏而不是右栏：改名与删除作用于"当前这一章"，
           * 标题栏就是它的位置指示器。放在右栏里，用户得先理解
           * "右栏的按钮为什么改的是中间这章"。
           */}
          {onRename ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              aria-label={t("Editor.chapter.rename")}
              title={t("Editor.chapter.rename")}
              onClick={onRename}
            >
              <Pencil className="icon-sm" />
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0 text-destructive hover:text-destructive"
              aria-label={t("Editor.chapter.delete")}
              title={t("Editor.chapter.delete")}
              onClick={onDelete}
            >
              <Trash2 className="icon-sm" />
            </Button>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {words} {t("Editor.chapter.words")}
          </span>
          <span className="flex items-center gap-1">
            {saveState === "saving" ? (
              <>
                <Loader2 className="icon-sm animate-spin" />
                {t("Editor.status.saving")}
              </>
            ) : saveState === "dirty" ? (
              t("Editor.status.dirty")
            ) : (
              <>
                <Check className="icon-sm" />
                {t("Editor.status.saved")}
              </>
            )}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={saveState === "saving"}
            onClick={saveNow}
          >
            <Save className="icon-sm" />
            {t("Editor.save.manual")}
          </Button>
          {/*
           * 撤回合并：合并是"破坏性"的（少了一张卡），
           * 因此在保存按钮旁给一个显式出口，而不只依赖 Ctrl+Z。
           */}
          {lastMerge ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={undoMerge}
            >
              <Undo2 className="icon-sm" />
              {t("Editor.card.undoMerge")}
            </Button>
          ) : null}
        </div>
      </header>

      {/*
       * 卡片区。
       *
       * `flex-1 min-h-0` + 自身滚动是关键：外层保持固定高度并把剩余空间
       * 全给滚动区，底部输入框因此恒定贴底，不会被卡片高度顶走。
       * 若这里少了 min-h-0，flex 子项会按内容撑开，输入框被推出可视区。
       */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {cards.length ? (
          <div
            ref={listRef}
            className="article-body prose-article mx-auto flex flex-col pl-9"
          >
            {cards.map((card, index) => (
              <CardItem
                key={card.id}
                card={card}
                index={index}
                total={cards.length}
                dimmed={dimOthers && editingIndex !== index}
                isActive={editingIndex === index}
                onEdit={handleCardClick}
                onMoveUp={moveUp}
                onMoveDown={moveDown}
                onSplit={splitCard}
                onMergeDown={mergeDown}
                onDelete={deleteCard}
              />
            ))}
          </div>
        ) : (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-muted-foreground">{t("Editor.empty")}</p>
            <p className="text-xs text-muted-foreground/70">{t("Editor.empty.hint")}</p>
          </div>
        )}
      </div>

      {/*
       * 底部编辑区：分割线以下整块都是输入区。
       *
       * 刻意不做 max-width 居中：分割线以下整条都是编辑区，
       * 输入框背景透明，透出应用底色；顶界由 ComposerInput 内那条
       * 80% 宽的细线给出，因此这里不再画满宽 border-t。
       *
       * 底色必须透明：应用外壳用的是 neutral-50 / neutral-700，
       * 而 bg-background 是另一套 token，直接铺会留下一块色差。
       */}
      <div className="shrink-0">
        <ComposerInput
          ref={composerRef}
          editingIndex={editingIndex}
          onSubmit={handleSubmit}
          onReturnToNew={returnToNew}
          pendingDraft={draft}
          onRestoreDraft={restoreDraft}
          onDiscardDraft={discardDraft}
        />
      </div>
    </div>
  );
}
