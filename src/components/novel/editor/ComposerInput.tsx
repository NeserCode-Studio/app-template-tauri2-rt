import { forwardRef, useImperativeHandle, useRef } from "react";
import { CornerDownLeft, X } from "lucide-react";

import { useI18n } from "@/composables";

export interface ComposerHandle {
  /** 把焦点移入输入框，可指定光标位置。 */
  focus: (caret?: "start" | "end") => void;
  /**
   * 写入文本（载入卡片到输入框时用）。
   *
   * animate 用于"暂存段落归位"那一次：让用户看见这段字从上方卡片
   * 落回了输入框。普通编辑载入卡片文本不该闪。
   */
  load: (text: string, caret?: "start" | "end", animate?: boolean) => void;
  /** 清空输入框。 */
  clear: () => void;
  /** 读取当前输入内容。 */
  read: () => string;
}

export interface ComposerInputProps {
  /**
   * 提交。editingIndex 为 -1 表示新建卡片，否则为被编辑卡片的原下标。
   * 文本已 trim，空文本不会被提交。
   */
  onSubmit: (text: string, editingIndex: number) => void;
  /** 正在编辑的卡片下标，-1 表示新建模式。仅用于显示提示。 */
  editingIndex: number;
  /**
   * 从「编辑已有卡片」退回「接着写新段落」。
   *
   * 点击时会把当前卡片原文留在卡片里（不做修改），输入框清空并回到追加模式。
   * 未提交时按 Esc 也会走这条路。
   */
  onReturnToNew?: () => void;
  /**
   * 暂存的新段落（未回车固化、也未落到正文里）。
   *
   * 用户在写新段落时点开某张旧卡片，草稿不会凭空消失——它作为一张卡片
   * 贴在输入框正上方（与输入框同属底部编辑区），点一下即可取回继续写。
   */
  pendingDraft?: string | null;
  /** 取回暂存段落。 */
  onRestoreDraft?: () => void;
  /** 丢弃暂存段落。 */
  onDiscardDraft?: () => void;
}

/**
 * 底部常驻输入框：整个编辑器唯一的输入区。
 *
 * 关键约束：
 * 1. 输入内容不经过 React state。每次按键 setState 会让中文输入法的
 *    组合态频繁重渲染，导致候选窗口抖动甚至丢字。
 * 2. 回车固化卡片，但必须先排除输入法确认态：
 *    `isComposing === true` 或 `keyCode === 229` 时不提交，
 *    否则输入法确认候选词会被当成提交，吞掉一段字。
 * 3. Shift+Enter 保留为换行，不提交。
 */
const ComposerInput = forwardRef<ComposerHandle, ComposerInputProps>(
  function ComposerInput(
    { onSubmit, editingIndex, onReturnToNew, pendingDraft, onRestoreDraft, onDiscardDraft },
    ref
  ) {
    const { t } = useI18n();
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    useImperativeHandle(ref, () => ({
      focus(caret = "end") {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        if (caret === "start") el.setSelectionRange(0, 0);
        else el.setSelectionRange(el.value.length, el.value.length);
      },
      load(text, caret = "end", animate = false) {
        const el = textareaRef.current;
        if (!el) return;
        el.value = text;
        el.focus();
        if (caret === "start") el.setSelectionRange(0, 0);
        else el.setSelectionRange(text.length, text.length);
        if (animate) {
          /* 重放动画：先移除再强制回流，才能对同一段文字重复触发。 */
          el.classList.remove("animate-draft-return");
          void el.offsetWidth;
          el.classList.add("animate-draft-return");
        }
      },
      clear() {
        const el = textareaRef.current;
        if (el) el.value = "";
      },
      read() {
        return textareaRef.current?.value ?? "";
      },
    }));

    return (
      <div className="flex flex-col gap-1.5 px-6 pb-3 pt-2">
        {/* 编辑区顶界：整条满宽，明确划出"正文"与"正在写"两个区域。 */}
        <div className="-mx-6 mb-1 h-px w-[calc(100%+3rem)] bg-border" />

        {/*
         * 暂存的新段落。
         *
         * 贴在输入框正上方而非正文末尾：它属于"还没提交的新段落"，
         * 视觉上属于编辑区，和正文卡片区分开，避免读起来像是正文的最后一段。
         */}
        {pendingDraft ? (
          <div className="group/draft relative flex items-start gap-2 rounded-md border border-dashed bg-muted/20 px-3 py-2">
            <button
              type="button"
              onClick={onRestoreDraft}
              className="prose-article min-w-0 flex-1 text-left text-sm"
            >
              {pendingDraft}
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={onRestoreDraft}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {t("Editor.input.restoreDraft")}
              </button>
              {onDiscardDraft ? (
                <button
                  type="button"
                  onClick={onDiscardDraft}
                  aria-label={t("Editor.input.discardDraft")}
                  title={t("Editor.input.discardDraft")}
                  className="flex size-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <X className="icon-sm" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="relative">
          <textarea
            ref={textareaRef}
            rows={3}
            placeholder={t("Editor.input.placeholder")}
            aria-label={t("Editor.input.placeholder")}
            /*
             * 背景透明，透出应用本身的底色——输入区不该是块比周围更亮的板子。
             * 聚焦不画任何边框 / 描边：底部本来就该始终是"在写"的状态，
             * 再叠一圈高亮反而像弹出了一个输入控件。
             */
            className="prose-article w-full resize-none border-0 bg-transparent px-0 py-1 outline-none ring-0 transition-colors placeholder:text-muted-foreground/50 focus:border-0 focus:outline-none focus:ring-0 focus-visible:border-0 focus-visible:outline-none focus-visible:ring-0"
            onKeyDown={(e) => {
              // 输入法组合中：Enter 属于候选确认，绝不提交。
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;

              // Esc：放弃当前编辑态，回到"接着写新段落"。
              if (e.key === "Escape") {
                e.preventDefault();
                if (editingIndex >= 0 && onReturnToNew) {
                  onReturnToNew();
                  e.currentTarget.value = "";
                }
                return;
              }

              if (e.key !== "Enter" || e.shiftKey) return;

              e.preventDefault();
              const text = e.currentTarget.value.trim();
              if (!text) return;
              // editing 时父组件知道是第几张卡；新建时传 -1。
              onSubmit(text, editingIndex);
              e.currentTarget.value = "";
            }}
          />

        </div>

        {/*
         * 提示行：左侧状态，右侧"回到最新段落"。
         * 用户点了某张旧卡片后，底部输入框就被那条卡片占住了，
         * 没有出口就只能继续改那张卡；这里给出明确的返回入口。
         */}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground/60">
          <span className="min-w-0 truncate">
            {editingIndex >= 0 ? (
              <>
                <span className="font-semibold text-foreground">
                  {t("Editor.input.editing")}
                </span>
                <span className="mx-1">·</span>
              </>
            ) : null}
            {t("Editor.input.hint")}
          </span>
          {editingIndex >= 0 && onReturnToNew ? (
            <button
              type="button"
              onClick={onReturnToNew}
              className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <CornerDownLeft className="icon-sm" />
              {t("Editor.input.returnNew")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }
);

export default ComposerInput;
