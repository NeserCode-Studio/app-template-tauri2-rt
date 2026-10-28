import { ChevronRight, FileText } from "lucide-react";

import { useI18n } from "@/composables";

/** 预览用的最小节点形状：只要 id / type / title，卷与章的回收记录都提供。 */
export interface PreviewNode {
  id: string;
  type: string;
  title: string;
}

export interface SubtreePreviewProps {
  /** 卷自身节点（subtree 的第一项），不在列表里重复显示。 */
  volume: PreviewNode | null;
  /** 卷下的章，按 order 升序。 */
  chapters: PreviewNode[];
}

/**
 * 卷删除 / 恢复前的章节预览。
 *
 * 卷的删除是级联的，一句"连同 3 章一起删除"回答不了"到底是哪三章"——
 * 而用户判断要不要删，靠的正是认不认得这些章名。给出标题列表，
 * 把判断依据交还给用户。
 *
 * 只列标题不列正文：正文在编辑器里随时能看，而这个弹窗要回答的是
 * "这一卷是不是我想删的那一卷"，标题已经足够辨识，再塞正文会让
 * 弹窗变成第二个编辑器。
 */
export default function SubtreePreview({ volume, chapters }: SubtreePreviewProps) {
  const { t } = useI18n();

  if (!chapters.length) {
    return <p className="text-xs text-muted-foreground">{t("Trash.volumeEmpty")}</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {volume ? (
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <ChevronRight className="icon-sm shrink-0 text-muted-foreground/60" />
          <span className="truncate">{volume.title}</span>
        </div>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {chapters.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-1.5 pl-4 text-xs text-muted-foreground"
          >
            <FileText className="icon-sm shrink-0 text-muted-foreground/40" />
            <span className="truncate">{c.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
