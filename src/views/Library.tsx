import { useI18n } from "@/composables";
import { Library as LibraryIcon } from "lucide-react";

/**
 * 作品库（M1）。
 *
 * 当前为阶段 0 的占位：仅承担空态引导，工作区选择、作品卡片网格、
 * 新建/重命名/归档/删除在阶段 2 实现。
 */
export default function Library() {
  const { t } = useI18n();

  return (
    <div className="view-library">
      <div className="library-empty">
        <LibraryIcon className="icon-lg" />
        <h1 className="view-title">{t("Library.title")}</h1>
        <p className="text-muted-sm">{t("Library.empty.hint")}</p>
      </div>
    </div>
  );
}
