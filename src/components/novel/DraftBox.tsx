import { useEffect, useState } from "react";
import { FileText, Trash2 } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { useI18n } from "@/composables";
import {
  DRAFTS_CHANGED_EVENT,
  listDrafts,
  migrateLegacyDrafts,
  removeDraft,
  type Draft,
} from "@/services/drafts";

/** 相对时间：草稿箱只关心"多久之前留的"。 */
function relative(at: number, now: number): string {
  const min = Math.floor((now - at) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} h ago`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} d ago`;
  return `${Math.floor(day / 30)} mo ago`;
}

/**
 * 草稿箱：集中列出所有"没提交成卡片"的半成品。
 *
 * 草稿改由 services/drafts 的集中 JSON 存储托管后，这里遍历即可。
 * 列表随自定义事件重渲染——草稿的写入发生在别的组件里，
 * localStorage 变化本身不会触发 React 更新。
 */
export interface DraftBoxProps {
  /** 跳到该草稿所属章节。 */
  onOpenChapter: (chapterId: string) => void;
}

/**
 * 底部草稿箱入口的变化闪动层。
 *
 * 监听与 state 必须封装在这里：若提升到 Editor，每次草稿变化都会重渲染
 * 整棵编辑树，章节清理 effect 又会重写草稿并广播，形成更新闭环。
 */
export function DraftFlashOverlay() {
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    const onChange = () => setFlashKey((n) => n + 1);
    window.addEventListener(DRAFTS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DRAFTS_CHANGED_EVENT, onChange);
  }, []);

  if (flashKey === 0) return null;

  return (
    <span
      key={flashKey}
      aria-hidden="true"
      className="draft-box-flash pointer-events-none absolute inset-0 z-10"
    />
  );
}

export default function DraftBox({ onOpenChapter }: DraftBoxProps) {
  const { t } = useI18n();
  const [tick, setTick] = useState(0);
  /** 每次收到草稿变化事件递增，用于重新触发背景闪动。 */
  const [flashKey, setFlashKey] = useState(0);
  /** 待确认删除的草稿；null 表示没有打开确认弹窗。 */
  const [pendingDelete, setPendingDelete] = useState<Draft | null>(null);
  const now = Date.now();
  const drafts = listDrafts();

  /*
   * 首次打开时把旧版分键草稿并进来（之后是空操作）；
   * 任处改动草稿都会广播事件，这里据此重读列表。
   * 迁移放在 effect 里而非渲染期：它会写 localStorage，是副作用。
   */
  useEffect(() => {
    migrateLegacyDrafts();
    setTick((n) => n + 1);
    const onChange = () => {
      setTick((n) => n + 1);
      setFlashKey((n) => n + 1);
    };
    window.addEventListener(DRAFTS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DRAFTS_CHANGED_EVENT, onChange);
  }, []);

  if (!drafts.length) {
    return (
      <div className="relative isolate h-full">
        {flashKey > 0 ? (
          <span
            key={flashKey}
            aria-hidden="true"
            className="draft-box-flash pointer-events-none absolute inset-0 z-0"
          />
        ) : null}
        <p className="relative z-10 px-3 py-6 text-center text-xs text-muted-foreground">
          {t("Editor.draft.empty")}
        </p>
      </div>
    );
  }

  return (
    <div className="relative isolate h-full">
      {flashKey > 0 ? (
        <span
          key={flashKey}
          aria-hidden="true"
          className="draft-box-flash pointer-events-none absolute inset-0 z-0"
        />
      ) : null}
      <div className="scrollbar-app relative z-10 h-full overflow-y-auto">
        <ul className="flex flex-col gap-1 px-2 pb-3 pt-2" data-tick={tick}>
          {drafts.map((d) => (
            <li key={d.key} className="group rounded-md border px-2.5 py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  onClick={() => onOpenChapter(d.chapterId)}
                  title={t("Editor.draft.open")}
                >
                  <FileText className="icon-sm shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">
                    {d.chapterTitle}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                    {relative(d.updatedAt, now)}
                  </span>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                  aria-label={t("Editor.draft.discard")}
                  title={t("Editor.draft.discard")}
                  onClick={() => setPendingDelete(d)}
                >
                  <Trash2 className="icon-sm" />
                </Button>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                {d.text}
              </p>
            </li>
          ))}
        </ul>

        {/*
         * 删除确认。草稿丢的就是"还没写完的那一段"，且草稿不落工作区、
         * 删除后没有任何回收站可捞，因此误触的代价不可逆。
         * removeDraft 内部已广播 drafts-changed，这里不再重复派发。
         */}
        <AlertDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => {
            if (!o) setPendingDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("Editor.draft.discardTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("Editor.draft.discardHint")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Library.dialog.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (pendingDelete) {
                    removeDraft(pendingDelete.workId, pendingDelete.chapterId);
                  }
                  setPendingDelete(null);
                }}
              >
                {t("Editor.draft.discard")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
