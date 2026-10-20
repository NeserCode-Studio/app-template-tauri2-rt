import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/composables";
import { useCodex } from "@/contexts/codex";
import { createLogger } from "@/lib/logger";
import { CommandHistory } from "@/lib/command-history";
import {
  cardsToText,
  countWords,
  dropHistory,
  rollbackTo,
  saveChapter,
} from "@/services/chapter";
import {
  DRAFT_REMOVED_EVENT,
  readDraftEntry,
  writeDraft,
  type DraftRemovedDetail,
} from "@/services/drafts";
import { cardSchema, type Card, type Chapter } from "@/shared/schema";
import type { ComposerHandle } from "./ComposerInput";

const log = createLogger("ChapterController");

/** 防抖自动保存间隔（计划书 §6.3：800ms）。 */
const AUTOSAVE_DELAY = 800;

type SaveState = "saved" | "dirty" | "saving";

/**
 * 段末句读：用于判断"这一段是否已经写完"。
 * 只认真正收束语义的标点，逗号顿号这类停顿符不算。
 */
const TERMINATORS = new Set([
  "。",
  "！",
  "？",
  "…",
  "）",
  "】",
  "》",
  "」",
  "』",
  "〉",
  "”",
  "’",
  ".",
  "!",
  "?",
  "…",
  ")",
  "]",
  "}",
  '"',
  "'",
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

export interface ChapterControllerOptions {
  chapter: Chapter;
  root: string;
  workId: string;
  onWordsChange?: (words: number) => void;
  onSaved?: (chapter: Chapter) => void;
  onWordsCommitted?: (chapterWords: number) => void;
}

/**
 * 章内容的全部状态与副作用。
 *
 * 从 ChapterEditor 里抽出来，是因为连续章节流需要把界面拆成三截
 * （标题栏 / 正文 / 输入框）分别放在屏幕的上、中、下，而这三截必须
 * 共享同一套 state。若把 state 留在某个界面组件里，另外两截就得靠
 * props 层层转发，切一章时要重挂的就不只是一个组件了。
 *
 * 这里只搬逻辑，不改行为：保存时机、防抖、撤销栈、草稿读写、
 * 卸载冲刷全部与原 ChapterEditor 一致。
 */
export function useChapterController({
  chapter,
  root,
  workId,
  onWordsChange,
  onSaved,
  onWordsCommitted,
}: ChapterControllerOptions) {
  const toast = useToast();
  const { syncChapterMentions } = useCodex();

  const [cards, setCards] = useState<Card[]>(chapter.cards);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [splitTarget, setSplitTarget] = useState<number | null>(null);
  /** 历史版本对话框开关。 */
  const [historyOpen, setHistoryOpen] = useState(false);
  /**
   * 章对象（带最新 history）的本地副本。
   *
   * 父级传下来的 chapter 只有在切章或重载时才更新，而每次保存都会新增一条
   * 快照。历史面板要在保存后立刻反映出来，就得自己持有这份副本。
   */
  const [chapterWithHistory, setChapterWithHistory] = useState(chapter);
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
  /*
   * 草稿改由 services/drafts 的集中 JSON 存储托管：
   * 统一成一个键，才能在草稿箱里遍历全部半成品（见 F2）。
   * 用 state 而非 useLocalStorageState，是为了自己控制读写时机——
   * 切章时要按 chapterId 重新读，不能让 ahooks 沿用上一章的值。
   */
  const [draft, setDraftState] = useState<string | null>(
    () => readDraftEntry(workId, chapter.id)?.stashedText ?? null
  );
  /** draft 的 ref 副本：回调里读最新值，不必把 draft 塞进依赖。 */
  const draftRef = useRef<string | null>(draft);

  const composerRef = useRef<ComposerHandle | null>(null);
  const historyRef = useRef<CommandHistory<Card[]> | null>(null);
  const saveTimer = useRef<number | null>(null);
  /** 待保存的最新卡片数组，卸载时 flush 用。 */
  const pendingCards = useRef<Card[] | null>(null);
  /** cards 的 ref 副本，供草稿持久化同步读取最新编辑目标。 */
  const cardsRef = useRef(cards);
  /** editingIndex 的 ref 副本，供防抖和卸载回调同步读取最新值。 */
  const editingIndexRef = useRef(-1);
  /** 输入框是否已经完成本章草稿的首次装载。 */
  const composerHydratedRef = useRef(false);
  /** 输入草稿防抖计时器。 */
  const draftSyncTimer = useRef<number | null>(null);

  /** 同一帧内同步更新编辑目标 state 与 ref。 */
  const setEditingTarget = useCallback((index: number) => {
    editingIndexRef.current = index;
    setEditingIndex(index);
  }, []);

  /** 暂存段落进入输入区上方时，只更新界面；持久化由调用方明确写入。 */
  const setPendingDraft = useCallback((value: string | null) => {
    draftRef.current = value;
    setDraftState(value);
  }, []);

  /** 取消尚未执行的输入草稿同步，避免旧内容覆盖显式操作。 */
  const cancelDraftSync = useCallback(() => {
    if (draftSyncTimer.current !== null) {
      window.clearTimeout(draftSyncTimer.current);
      draftSyncTimer.current = null;
    }
  }, []);

  /**
   * 保存一份完整草稿快照。
   *
   * text 是输入框当前内容；编辑旧段落时还必须同时保存卡片 id 与暂存段落。
   * 三者分开后，切章回来才能恢复“正在改哪一段”，而不是把旧段原文
   * 当成一段新草稿重新灌进输入框。
   */
  const persistDraftSnapshot = useCallback(
    (
      text: string,
      index = editingIndexRef.current,
      stashedText: string | null = draftRef.current
    ) => {
      cancelDraftSync();
      const editingCardId =
        index >= 0 ? cardsRef.current[index]?.id : undefined;
      const normalizedStashed = stashedText?.trim() || undefined;
      writeDraft({
        text: text.trim(),
        workId,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        ...(editingCardId ? { editingCardId } : {}),
        ...(normalizedStashed ? { stashedText: normalizedStashed } : {}),
      });
    },
    [workId, chapter.id, chapter.title, cancelDraftSync]
  );

  /**
   * 输入框内容变化时同步草稿。
   *
   * 清空必须立即落盘，否则草稿箱会继续显示一份已经不存在的文本；
   * 正常输入则防抖，避免每次按键都重写 localStorage 并广播重渲染。
   */
  const handleComposerTextChange = useCallback(
    (text: string) => {
      if (!text.trim()) {
        persistDraftSnapshot(
          "",
          editingIndexRef.current,
          draftRef.current
        );
        return;
      }
      cancelDraftSync();
      draftSyncTimer.current = window.setTimeout(() => {
        draftSyncTimer.current = null;
        persistDraftSnapshot(
          text,
          editingIndexRef.current,
          draftRef.current
        );
      }, 300);
    },
    [cancelDraftSync, persistDraftSnapshot]
  );

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
        /*
         * 保存会顺带压入一份历史快照，所以要用返回值而不是本地 next：
         * 只有返回值才带最新的 history，并把它写回 chapterRef，
         * 否则下一次保存会以缺失 history 的版本为基准，快照链断掉。
         */
        const saved = await saveChapter(root, workId, next);
        chapterRef.current = saved;
        setChapterWithHistory(saved);
        try {
          await syncChapterMentions(workId, chapter.id, cardsToText(nextCards));
        } catch (err) {
          log.warn("mention index sync failed", err);
        }
        /*
         * 作品库的字数来自 stats.json。作品总字数是全书各章之和，
         * 由父级汇总后写入——单章字数不等于作品字数，这里只上报本章。
         */
        onWordsCommitted?.(countWords(cardsToText(nextCards)));
        pendingCards.current = null;
        setSaveState("saved");
        onSaved?.(saved);
        log.debug("chapter saved", { cards: nextCards.length });
      } catch (err) {
        log.error("save failed", err);
        setSaveState("dirty");
        toast.error("Editor.save.failed");
      }
    },
    [
      root,
      workId,
      chapter.id,
      syncChapterMentions,
      onSaved,
      onWordsCommitted,
      toast,
    ]
  );

  /**
   * 删除某个历史版本。
   *
   * 落盘时关掉快照：正文没改动，只是删了一条历史。若照常留快照，
   * 会凭空多出一个与当前正文完全相同的版本——历史列表越删越脏。
   */
  const dropVersion = useCallback(
    async (index: number) => {
      const base = chapterRef.current;
      const next = dropHistory(base, index);
      if (next === base) return;
      try {
        const saved = await saveChapter(root, workId, next, false);
        chapterRef.current = saved;
        setChapterWithHistory(saved);
      } catch (err) {
        log.error("drop history failed", err);
        toast.error("Editor.save.failed");
      }
    },
    [root, workId, toast]
  );

  /* 切章时重置：卡片、编辑态、历史栈。依赖 chapter.id 而非 chapter，
     否则父级回传保存结果会触发重置，把本地编辑态冲掉。 */
  const chapterId = chapter.id;
  const initialCards = chapter.cards;
  useEffect(() => {
    setCards(initialCards);
    setSaveState("saved");
    setChapterWithHistory(chapter);
    pendingCards.current = null;
    /*
     * 切章时按新章重新读取完整草稿。
     *
     * text 灌回输入框；editingCardId 用来恢复“正在改哪一段”；
     * stashedText 才重新渲染输入框上方的暂存卡。三者不能混为一个字符串，
     * 否则编辑旧段落时切章回来就会退化成一段新段落草稿。
     */
    const storedDraft = readDraftEntry(workId, chapterId);
    const restoredEditingIndex = storedDraft?.editingCardId
      ? initialCards.findIndex((card) => card.id === storedDraft.editingCardId)
      : -1;
    const nextEditingIndex =
      restoredEditingIndex >= 0 ? restoredEditingIndex : -1;
    setEditingTarget(nextEditingIndex);
    setPendingDraft(
      nextEditingIndex >= 0 ? (storedDraft?.stashedText ?? null) : null
    );
    historyRef.current = new CommandHistory<Card[]>(initialCards);
    /*
     * 把这一章自己的草稿灌回输入框。切回来要能接着写，
     * 这是草稿存 localStorage（而非组件 state）的唯一理由。
     * 顺带进入可写作状态：不必先去点某张卡片才能落笔。
     */
    const nextText = storedDraft?.text ?? null;
    requestAnimationFrame(() => {
      composerRef.current?.clear();
      if (nextText) composerRef.current?.load(nextText, "end", true);
      composerRef.current?.focus("end");
      composerHydratedRef.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);

  /*
   * 草稿箱删除当前章草稿时，持久化记录与输入框必须一起清掉。
   * 否则卸载清理会把输入框里同一段文字重新写回，表现为“切回来又出现”。
   */
  useEffect(() => {
    const onDraftRemoved = (event: Event) => {
      const detail = (event as CustomEvent<DraftRemovedDetail>).detail;
      if (
        !detail ||
        detail.workId !== workId ||
        detail.chapterId !== chapterId
      ) {
        return;
      }
      cancelDraftSync();
      setPendingDraft(null);
      setEditingTarget(-1);
      composerRef.current?.clear();
    };
    window.addEventListener(DRAFT_REMOVED_EVENT, onDraftRemoved);
    return () =>
      window.removeEventListener(DRAFT_REMOVED_EVENT, onDraftRemoved);
  }, [
    workId,
    chapterId,
    cancelDraftSync,
    setEditingTarget,
    setPendingDraft,
  ]);

  /**
   * 回滚到某个历史快照。
   *
   * 回滚本身也要落盘（否则下次保存会拿当前正文当"上一版"再存一份，
   * 刚回滚掉的内容又留在了历史里）。历史栈清空重建，避免用户按 Ctrl+Z
   * 回到回滚之前那个"已被回滚掉"的中间状态。
   */
  const rollback = useCallback(
    async (index: number) => {
      const base = chapterRef.current;
      const restored = rollbackTo(base, index);
      if (restored === base) return;
      setSaveState("saving");
      try {
        /*
         * 传 snapshot=false：rollbackTo 已经把"回滚前的正文"存进历史，
         * 若这里再让 saveChapter 存一次，存的会是刚回滚回去的正文——
         * 等于把目标版本又抄了一份。两次存档叠加，回滚一次就多两条。
         */
        const saved = await saveChapter(root, workId, restored, false);
        chapterRef.current = saved;
        setChapterWithHistory(saved);
        try {
          await syncChapterMentions(
            workId,
            chapter.id,
            cardsToText(saved.cards)
          );
        } catch (err) {
          log.warn("mention index sync failed after rollback", err);
        }
        setCards(saved.cards);
        setEditingTarget(-1);
        historyRef.current = new CommandHistory<Card[]>(saved.cards);
        setSaveState("saved");
        setHistoryOpen(false);
        onWordsCommitted?.(countWords(cardsToText(saved.cards)));
        onSaved?.(saved);
        toast.success("Editor.history.restored");
      } catch (err) {
        log.error("rollback failed", err);
        setSaveState("dirty");
        toast.error("Editor.save.failed");
      }
    },
    [
      root,
      workId,
      chapter.id,
      syncChapterMentions,
      setEditingTarget,
      onSaved,
      onWordsCommitted,
      toast,
    ]
  );

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
   *
   * 滚的是宿主传入的容器：连续章节流里正文不再由本章自己持有，
   * 若还按 listRef 找，就什么也找不到，打字机模式会静默失效。
   */
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (editingIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-card-index="${editingIndex}"]`
    );
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [editingIndex]);

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
   * 追加导入的卡片。
   *
   * 导入必须走控制器而不是父级重新 loadChapter：同一章不会因内容更新
   * 重挂 ChapterStream，直接替换父级 chapter 会冲掉当前草稿和撤销栈。
   * 这里与手动新增段落共用 applyCards，保存、历史记录和提及同步都一致。
   */
  const importCards = useCallback(
    (incoming: Card[]) => {
      if (!incoming.length) return 0;
      const next = [...cardsRef.current, ...incoming];
      cardsRef.current = next;
      applyCards(next);
      return incoming.length;
    },
    [applyCards]
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
          i === index
            ? cardSchema.parse({ ...c, text: text, updatedAt: now })
            : c
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
        setPendingDraft(null);
        setEditingTarget(-1);
        persistDraftSnapshot(stashed, -1, null);
        requestAnimationFrame(() =>
          composerRef.current?.load(stashed, "end", true)
        );
        return;
      }

      setPendingDraft(null);
      setEditingTarget(-1);
      persistDraftSnapshot("", -1, null);
    },
    [
      cards,
      applyCards,
      persistDraftSnapshot,
      setEditingTarget,
      setPendingDraft,
    ]
  );

  /** 点击卡片：载入输入框编辑。 */
  const handleCardClick = useCallback(
    (index: number) => {
      const card = cardsRef.current[index];
      if (!card) return;
      /*
       * 正在写新段落时点开旧卡片，先把草稿暂存起来。
       * load() 会覆盖 textarea.value，若不扣下草稿就直接被冲掉了。
       * 已经在编辑某张卡时则不暂存——那时输入框里的内容属于那张卡。
       */
      if (editingIndexRef.current < 0) {
        const pending = composerRef.current?.read().trim() ?? "";
        if (pending) {
          setPendingDraft(pending);
        }
      }
      setEditingTarget(index);
      /*
       * 先把旧卡正文与目标 id 写进草稿，再异步载入输入框。
       * 这样即使紧接着切章，持久化记录也已经指向正确卡片。
       */
      persistDraftSnapshot(card.text, index, draftRef.current);
      // 下一帧再 focus，确保 textarea 已渲染出 editing 提示。
      requestAnimationFrame(() => {
        composerRef.current?.load(card.text, "end");
      });
    },
    [persistDraftSnapshot, setEditingTarget, setPendingDraft]
  );

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
        i === index
          ? cardSchema.parse({ ...c, text: typed, updatedAt: now })
          : c
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
    setPendingDraft(null);
    setEditingTarget(-1);
    persistDraftSnapshot(stashed ?? "", -1, null);
    composerRef.current?.clear();
    requestAnimationFrame(() =>
      composerRef.current?.load(stashed ?? "", "end", Boolean(stashed))
    );
  }, [
    persistDraftSnapshot,
    scheduleSave,
    setEditingTarget,
    setPendingDraft,
  ]);

  /** 取回暂存段落：清空输入框回到追加模式，并把草稿放回去。 */
  const restoreDraft = useCallback(() => {
    const text = draft ?? "";
    setEditingTarget(-1);
    setPendingDraft(null);
    persistDraftSnapshot(text, -1, null);
    requestAnimationFrame(() => composerRef.current?.load(text, "end", true));
  }, [
    draft,
    persistDraftSnapshot,
    setEditingTarget,
    setPendingDraft,
  ]);

  /**
   * 丢弃暂存段落。
   *
   * 必须连 ref 一起清。只清 state 的话卡片照样消失，但 draftRef 还留着
   * 文本：下一次点开旧卡片再提交，handleSubmit 会把这段"扣下"又放回
   * 输入框，用户会发现刚丢掉的段落又回来了。setPendingDraft 会同步 ref，
   * 同时重写一份只保留当前旧卡内容的快照。
   */
  const discardDraft = useCallback(() => {
    setPendingDraft(null);
    persistDraftSnapshot(
      composerRef.current?.read() ?? "",
      editingIndexRef.current,
      null
    );
  }, [persistDraftSnapshot, setPendingDraft]);

  /* cards 的 ref 副本，供回调读取最新值。 */
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
        setPendingDraft(null);
        setEditingTarget(-1);
        composerRef.current?.clear();
        persistDraftSnapshot("", -1, null);
      } else if (editingIndexRef.current > index) {
        setEditingTarget(editingIndexRef.current - 1);
      }
    },
    [
      cards,
      applyCards,
      persistDraftSnapshot,
      setEditingTarget,
      setPendingDraft,
    ]
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
   * 这是数据可靠性的关键点：控制器以 chapter.id 为 key，切换章节或
   * 返回作品库都会立刻卸载本组件。仅 clearTimeout 会把防抖窗口内固化的
   * 卡片直接丢掉——用户看到的是"已保存"，退出再进来却空章。
   */
  useEffect(() => {
    /*
     * 卸载时的数据可能已经被 React 拆掉（ref 置空、DOM 卸载）。
     * 因此这里先把输入框的值读出来存进闭包，cleanup 里再用——
     * 直接在 cleanup 里读 composerRef.current，可能拿到 null 而静默丢稿。
     */
    const composer = composerRef.current;
    return () => {
      cancelDraftSync();
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const cards = pendingCards.current;
      if (cards) void persistNow(cards);
      /*
       * 输入框里的半成品同样要在这里存成完整草稿。
       *
       * 父级用 `key={chapter.id}` 渲染本组件，所以**切章走的是卸载，
       * 不是 chapterId effect**——之前只在 effect 里补草稿的话根本不会触发。
       * 卸载是"任何原因离开这一章"的唯一汇合点：切章、回作品库、关窗口，
       * 三条路径都在这里收口。
       */
      const typed = composer?.read().trim() ?? "";
      if (composerHydratedRef.current && (typed || draftRef.current)) {
        persistDraftSnapshot(
          typed,
          editingIndexRef.current,
          draftRef.current
        );
      }
    };
    // chapterId / workId / chapter.title 在卸载时读取，均为本章的稳定值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistNow]);

  return {
    cards,
    editingIndex,
    saveState,
    splitTarget,
    setSplitTarget,
    historyOpen,
    setHistoryOpen,
    chapterWithHistory,
    lastMerge,
    draft,
    words,
    composerRef,
    listRef,
    persistNow,
    importCards,
    dropVersion,
    rollback,
    saveNow,
    undo,
    redo,
    handleSubmit,
    handleComposerTextChange,
    handleCardClick,
    returnToNew,
    restoreDraft,
    discardDraft,
    moveUp,
    moveDown,
    splitCard,
    confirmSplit,
    mergeDown,
    undoMerge,
    deleteCard,
  };
}
