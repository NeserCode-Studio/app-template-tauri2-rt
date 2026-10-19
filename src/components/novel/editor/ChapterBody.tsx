import { useI18n } from "@/composables";
import type { Card } from "@/shared/schema";
import CardItem from "./CardItem";

/**
 * 章正文：卡片列表。
 *
 * 与 ChapterHeader / ComposerInput 平级，由连续章节流把三者分别摆在
 * 屏幕上、中、下三处。它只负责渲染，不含任何保存或草稿逻辑——
 * 那些都在 useChapterController 里，由流的顶层持有。
 *
 * 因此这里刻意不自己滚动：滚动是流的属性。一章一个滚动容器的话，
 * "往下看下一章"会变成逐章翻页，流就断了。
 */
export default function ChapterBody({
  cards,
  editingIndex,
  dimOthers,
  onEdit,
  onMoveUp,
  onMoveDown,
  onSplit,
  onMergeDown,
  onDelete,
  onOpenCodexEntry,
  listRef,
}: {
  cards: Card[];
  editingIndex: number;
  /** 专注模式：非当前卡片压暗。 */
  dimOthers: boolean;
  onEdit: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onSplit: (index: number) => void;
  onMergeDown: (index: number) => void;
  onDelete: (index: number) => void;
  onOpenCodexEntry?: (entryId: string) => void;
  /** 滚动容器由宿主提供，这里只挂 ref 供打字机模式定位活动卡。 */
  listRef?: React.Ref<HTMLDivElement>;
}) {
  const { t } = useI18n();

  if (!cards.length) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">{t("Editor.empty")}</p>
        <p className="text-xs text-muted-foreground/70">{t("Editor.empty.hint")}</p>
      </div>
    );
  }

  return (
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
          onEdit={onEdit}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onSplit={onSplit}
          onMergeDown={onMergeDown}
          onDelete={onDelete}
          onOpenCodexEntry={onOpenCodexEntry}
        />
      ))}
    </div>
  );
}
