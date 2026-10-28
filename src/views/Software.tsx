import { useI18n } from "@/composables";

export default function Software() {
  const { t } = useI18n();

  return (
    <div className="view">
      <h1 className="view-title">{t("Software.title")}</h1>
    </div>
  );
}
