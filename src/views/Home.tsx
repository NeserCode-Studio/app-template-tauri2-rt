import { useI18n } from "@/composables";

export default function Home() {
  const { t } = useI18n();

  return (
    <div className="view-home">
      <h1 className="view-title">{t("Home.title")}</h1>
    </div>
  );
}
