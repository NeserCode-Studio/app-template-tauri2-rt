import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import CardItem from "./CardItem";
import ComposerInput, { type ComposerHandle } from "./ComposerInput";
import SplitDialog from "./SplitDialog";

import { useI18n } from "@/composables";
import { useToast } from "@/composables";
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
}

/** 防抖自动保存间隔（计划书 §6.3：800ms）。 */
const AUTOSAVE_DELAY = 800;

type SaveState = "saved" | "dirty" | "saving";

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
}: ChapterEditorProps) {
  const { t } = useI18n();
  const toast = useToast();

  const [cards, setCards] = useState<Card[]>(chapter.cards);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [splitTarget, setSplitTarget] = useState<number | null>(null);

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
    [root, workId, onSaved, toast]
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
      setEditingIndex(-1);
    },
    [cards, applyCards]
  );

  /** 点击卡片：载入输入框编辑。 */
  const handleCardClick = useCallback((index: number) => {
    setEditingIndex(index);
    // 下一帧再 focus，确保 textarea 已渲染出 editing 提示。
    requestAnimationFrame(() => {
      const card = cardsRef.current[index];
      if (card) composerRef.current?.load(card.text, "end");
    });
  }, []);

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

  /** 合并：当前卡与下一张合并为一张。 */
  const mergeDown = useCallback(
    (index: number) => {
      if (index >= cards.length - 1) return;
      const merged = `${cards[index].text}\n${cards[index + 1].text}`;
      const next = [
        ...cards.slice(0, index),
        { ...cards[index], text: merged, updatedAt: Date.now() },
        ...cards.slice(index + 2),
      ];
      applyCards(next);
    },
    [cards, applyCards]
  );

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

  /* ---------- 撤销 / 重做 ---------- */
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
          <div className="article-body prose-article mx-auto flex flex-col pl-8">
            {cards.map((card, index) => (
              <CardItem
                key={card.id}
                card={card}
                index={index}
                total={cards.length}
                dimmed={false}
                isActive={editingIndex === index}
                onClick={handleCardClick}
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

      {/* 底部输入框：常驻，不随卡片数量滚动消失 */}
      <div className="border-t px-6 py-3">
        <div className="mx-auto max-w-3xl">
          <ComposerInput ref={composerRef} editingIndex={editingIndex} onSubmit={handleSubmit} />
        </div>
      </div>
    </div>
  );
}
