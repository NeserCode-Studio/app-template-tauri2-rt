import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { CornerDownLeft, Trash2 } from "lucide-react";

import { useI18n } from "@/composables";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  /**
   * 输入框原始内容变化。
   *
   * 内容仍不进入 React state；控制器只据此防抖同步草稿，
   * 清空时则立即删除草稿。
   */
  onTextChange?: (text: string) => void;
}

/**
 * 底部常驻输入框：整个编辑器唯一的输入区。
 *
 * 关键约束：
 * 1. 输入内容不经过 React state。每次按键 setState 会让中文输入法的
 *    组合态频繁重渲染，导致候选窗口抖动甚至丢字。
 * 2. 回车结束本段，但必须先排除输入法确认态：
 *    `isComposing === true` 或 `keyCode === 229` 时不提交，
 *    否则输入法确认候选词会被当成提交，吞掉一段字。
 * 3. Shift+Enter 同样结束本段——段落不主动折行，
 *    硬敲出来的 \n 进正文只是脏数据（导出多一空行、字数统计多一字符），
 *    既然换行没有表达力，就不给它一个手势。
 *
 * 提交按钮常驻右下角：回车是给手在键盘上的人用的，
 * 总要有一条不依赖键盘的路。
 */
const ComposerInput = forwardRef<ComposerHandle, ComposerInputProps>(
  function ComposerInput(
    {
      onSubmit,
      editingIndex,
      onReturnToNew,
      pendingDraft,
      onRestoreDraft,
      onDiscardDraft,
      onTextChange,
    },
    ref
  ) {
    const { t } = useI18n();
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    /** 丢弃确认弹窗的开关：丢弃不可撤销，先问一句再动手。 */
    const [discardOpen, setDiscardOpen] = useState(false);
    /**
     * 只服务于提交按钮的可用状态。
     * 正文本身不经过 state（中文输入法会抖），但按钮得知道"能不能提交"，
     * 所以这里放一个布尔量而不是整段文本——重渲染成本一样，语义更窄。
     */
    const [hasText, setHasText] = useState(false);

    /** 回车与按钮共用同一条提交路径，避免两处行为漂移。 */
    const submit = useCallback(() => {
      const el = textareaRef.current;
      if (!el) return;
      const text = el.value.trim();
      if (!text) return;
      onSubmit(text, editingIndex);
      el.value = "";
      setHasText(false);
    }, [onSubmit, editingIndex]);

    useImperativeHandle(ref, () => ({
      focus(caret = "end") {
        const el = textareaRef.current;
        if (!el) return;
        /*
         * preventScroll：聚焦不该顺带把容器滚到输入框。
         *
         * 输入框本来就固定在屏幕底部、始终可见，浏览器这次"滚动到可见"
         * 没有任何收益，却会把切章时刚落到章尾的视口拽走——它还是异步
         * 布局行为，晚于调用方设置的 scrollTop 生效，事后根本拦不住。
         */
        el.focus({ preventScroll: true });
        if (caret === "start") el.setSelectionRange(0, 0);
        else el.setSelectionRange(el.value.length, el.value.length);
      },
      load(text, caret = "end", animate = false) {
        const el = textareaRef.current;
        if (!el) return;
        el.value = text;
        setHasText(text.trim().length > 0);
        /*
         * preventScroll：输入框固定在屏幕底部，永远可见，
         * 不需要浏览器"把它滚进视口"。而默认行为会把正文滚动区
         * 往上拽，冲掉切章时刚设好的落点（上滑回上一章要落在章尾）。
         */
        el.focus({ preventScroll: true });
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
        setHasText(false);
      },
      read() {
        return textareaRef.current?.value ?? "";
      },
    }), []);

    return (
      <>
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
                  onClick={() => setDiscardOpen(true)}
                  aria-label={t("Editor.input.discardDraft")}
                  title={t("Editor.input.discardDraft")}
                  className="flex size-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="icon-sm" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="relative">
          <textarea
            ref={textareaRef}
            placeholder={t("Editor.input.placeholder")}
            aria-label={t("Editor.input.placeholder")}
            /*
             * 背景透明，透出应用本身的底色——输入区不该是块比周围更亮的板子。
             * 聚焦不画任何边框 / 描边：底部本来就该始终是"在写"的状态，
             * 再叠一圈高亮反而像弹出了一个输入控件。
             */
            /*
             * field-sizing: content 让 textarea 高度跟着内容走，不需要 JS 测量。
             * min-h 给空稿一个落脚点；max-h 封顶后由 overflow-y-auto 内部滚动，
             * 免得长草稿把正文区整个顶出视口。
             *
             * 右侧用 -mr-6 + w 补偿把文本框撑出容器内边距，让滚动条贴着
             * 面板边缘。只留 pr 的话滚动条会离边框差一整个 px-6（24px），
             * 视觉上像是飘在中间。左边不补偿，文字仍与正文对齐。
             */
            className="prose-article [field-sizing:content] scrollbar-app -mr-6 max-h-[220px] min-h-[3lh] w-[calc(100%+1.5rem)] resize-none overflow-y-auto border-0 bg-transparent py-1 pr-1 outline-none ring-0 transition-colors placeholder:text-muted-foreground/50 focus:border-0 focus:outline-none focus:ring-0 focus-visible:border-0 focus-visible:outline-none focus-visible:ring-0"
            onInput={(e) => {
              const text = e.currentTarget.value;
              setHasText(text.trim().length > 0);
              onTextChange?.(text);
            }}
            onKeyDown={(e) => {
              // 输入法组合中：Enter 属于候选确认，绝不提交。
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;

              // Esc：放弃当前编辑态，回到"接着写新段落"。
              if (e.key === "Escape") {
                e.preventDefault();
                if (editingIndex >= 0 && onReturnToNew) {
                  onReturnToNew();
                  e.currentTarget.value = "";
                  setHasText(false);
                }
                return;
              }

              /*
               * Shift+回车不再插入换行：一段就是一段。
               *
               * 段落不主动折行，正文宽度由排版决定，所以在输入框里
               * 硬敲一个 \n 进卡片只会成为脏数据——导出时是一行空行，
               * 统计字数时还可能被当成一个字符。既然换行没有表达力，
               * 就让回车一律提交，别给一个会写坏正文的手势。
               */
              if (e.key !== "Enter") return;

              e.preventDefault();
              submit();
            }}
          />

        </div>

        {/*
         * 提示行常驻：左状态，右操作。
         *
         * 这一行的位置是被"编辑已有段落"的状态提示占住的——用户点了某张
         * 旧段落后，输入框就被那条段落占住，没有出口就只能继续改它，
         * 所以"回到最新段落"必须一直在。但既然行本来就在，追加新段落时
         * 就让左边空着，不必再让整行随状态闪进闪出。
         *
         * 追加态左位刻意不放操作提示：placeholder 里已经写着"回车结束本段"，
         * 同一句话在下面再说一遍是纯重复，而且那里离手指更近、反而先被读到。
         *
         * 右侧最外是提交按钮：它是这一行唯一的主动作，放在最右端符合
         * "确认在末端"的读法。
         */}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground/60">
          {editingIndex >= 0 ? (
            <span className="min-w-0 truncate font-semibold text-foreground">
              {t("Editor.input.editing")}
            </span>
          ) : (
            <span className="min-w-0" />
          )}
          <div className="flex shrink-0 items-center gap-1">
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
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!hasText}
              onClick={submit}
              className="h-7 gap-1.5 px-2 text-xs"
            >
              <CornerDownLeft className="icon-sm" />
              {t("Editor.input.submit")}
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Editor.input.discardDraftTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Editor.input.discardDraftHint")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Library.dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setDiscardOpen(false);
                onDiscardDraft?.();
              }}
            >
              {t("Editor.input.discardDraftConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </>
    );
  }
);

export default ComposerInput;
