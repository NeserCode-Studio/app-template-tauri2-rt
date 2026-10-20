import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Combine, Scissors, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useI18n, useToast } from "@/composables";
import { useCodex } from "@/contexts/codex";
import { typeLabel } from "@/services/codex";

export interface TextContextMenuProps {
  index: number;
  total: number;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onSplit: (index: number) => void;
  onMergeDown: (index: number) => void;
  onDelete: (index: number) => void;
  children: React.ReactNode;
}

/**
 * 正文右键菜单。
 *
 * 两套内容按"有没有选中文字"切换：
 * - 有选区：复制 + 快捷添加素材（把选中的词变成素材条目）。
 *   看到人名不认识就当场建条目，是写作时最高频的意图。
 * - 无选区：段落操作（拆分、拼合、重排、删除）。
 *
 * 不选中文字时也要能拿到段落操作——否则用户为了删一段，
 * 得先选中它，多一个无意义的前置动作。
 */
export default function TextContextMenu({
  index,
  total,
  onMoveUp,
  onMoveDown,
  onSplit,
  onMergeDown,
  onDelete,
  children,
}: TextContextMenuProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { entries, typeConfigs, colorOf, create, setCurrentEntryId } =
    useCodex();
  const [selected, setSelected] = useState("");

  /*
   * 右键时读选区。注意不能在 render 期读：ContextMenu 的内容在
   * 打开时才挂载，那时选区可能已经被点击清掉了。
   */
  useEffect(() => {
    const read = () =>
      setSelected(window.getSelection()?.toString().trim() ?? "");
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, []);

  /** 选中的词是否已经是某个条目的名字或别名。 */
  const exists = selected
    ? entries.some(
        (e) => e.name === selected || e.aliases.some((a) => a === selected)
      )
    : false;

  async function addCodex(typeId: string) {
    if (!selected) return;
    try {
      const entry = await create(typeId, selected);
      if (entry) {
        setCurrentEntryId(entry.id);
        toast.success("Codex.save");
      }
    } catch {
      toast.error("Library.toast.failed");
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild data-preserve-context-menu>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {selected ? (
          <>
            <ContextMenuItem
              onSelect={() => {
                void navigator.clipboard
                  .writeText(selected)
                  .catch(() => undefined);
              }}
            >
              {t("ContextMenu.copy")}
              <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            {exists ? (
              <ContextMenuItem disabled>
                {t("ContextMenu.alreadyCodex")}
              </ContextMenuItem>
            ) : (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  {t("ContextMenu.addCodex")}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {typeConfigs.map((tp) => (
                    <ContextMenuItem
                      key={tp.id}
                      onSelect={() => void addCodex(tp.id)}
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: colorOf(tp.id) }}
                      />
                      {typeLabel(tp, t)}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
            <ContextMenuSeparator />
          </>
        ) : null}

        <ContextMenuItem onSelect={() => onSplit(index)}>
          <Scissors className="icon-sm" />
          {t("Editor.card.split")}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={index === total - 1}
          onSelect={() => onMergeDown(index)}
        >
          <Combine className="icon-sm" />
          {t("Editor.card.merge")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={index === 0}
          onSelect={() => onMoveUp(index)}
        >
          <ArrowUp className="icon-sm" />
          {t("Editor.card.moveUp")}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={index === total - 1}
          onSelect={() => onMoveDown(index)}
        >
          <ArrowDown className="icon-sm" />
          {t("Editor.card.moveDown")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => onDelete(index)}>
          <Trash2 className="icon-sm" />
          {t("Editor.card.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
