import { useI18n } from "@/composables";
import { ExternalLink } from "lucide-react";

const TECH_KEYS = [
  "vite",
  "react",
  "typescript",
  "tailwind",
  "tauri",
  "radix",
  "react-router",
  "zod",
  "ahooks",
  "embla",
] as const;

export default function Framework() {
  const { t } = useI18n();

  return (
    <div className="view-framework">
      <h1 className="title">{t("Framework.title")}</h1>
      <p className="framework-intro">{t("Framework.intro")}</p>

      <div className="tech-cards">
        {TECH_KEYS.map((key) => (
          <a
            key={key}
            href={t(`Framework.card.${key}.url`)}
            target="_blank"
            rel="noopener noreferrer"
            className="tech-card"
          >
            <div className="tech-card-content">
              <span className="tech-card-name">
                {t(`Framework.card.${key}.name`)}
                <ExternalLink className="tech-card-link-icon" />
              </span>
              <span className="tech-card-desc">
                {t(`Framework.card.${key}.description`)}
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}