import { forwardRef, useImperativeHandle, useRef } from "react";

import { useI18n } from "@/composables";

export interface ComposerHandle {
  /** 把焦点移入输入框，可指定光标位置。 */
  focus: (caret?: "start" | "end") => void;
  /** 写入文本（载入卡片到输入框时用）。 */
  load: (text: string, caret?: "start" | "end") => void;
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
  function ComposerInput({ onSubmit, editingIndex }, ref) {
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
      load(text, caret = "end") {
        const el = textareaRef.current;
        if (!el) return;
        el.value = text;
        el.focus();
        if (caret === "start") el.setSelectionRange(0, 0);
        else el.setSelectionRange(text.length, text.length);
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
      <div className="flex flex-col gap-1.5">
        <div className="relative">
          <textarea
            ref={textareaRef}
            rows={3}
            placeholder={t("Editor.input.placeholder")}
            aria-label={t("Editor.input.placeholder")}
            className="prose-article w-full resize-none rounded-md border bg-background px-3 py-2 outline-none transition-colors placeholder:text-muted-foreground/50 focus-visible:border-ring"
            onKeyDown={(e) => {
              // 输入法组合中：Enter 属于候选确认，绝不提交。
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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

        <p className="text-xs text-muted-foreground/60">
          {editingIndex >= 0 ? (
            <>
              <span className="font-semibold text-foreground">
                {t("Editor.input.editing")}
              </span>
              <span className="mx-1">·</span>
            </>
          ) : null}
          {t("Editor.input.hint")}
        </p>
      </div>
    );
  }
);

export default ComposerInput;
