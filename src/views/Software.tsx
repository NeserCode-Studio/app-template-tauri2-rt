import { useI18n } from "@/composables";

export default function Software() {
  const { t } = useI18n();

  return (
    <div className="view-software">
      <h1 className="title">{t("Software.title")}</h1>
    </div>
  );
}
