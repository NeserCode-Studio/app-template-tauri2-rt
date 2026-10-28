import { useContext } from "react";
import { useI18n } from "@/composables";
import { NavigatorContext } from "@/contexts/navigator";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink } from "lucide-react";

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
] as const;

export default function Framework() {
  const { t } = useI18n();
  const { navigator } = useContext(NavigatorContext);

  return (
    <div className="view-framework">
      <div className="flex flex-row items-start justify-between gap-4 mb-6">
        <div className="flex flex-col min-w-0">
          <h1 className="mb-2 text-2xl font-bold text-foreground">
            {t("Framework.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("Framework.intro")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => navigator("/")}
        >
          <ArrowLeft className="icon-md" />
          {t("Command.turnto.home")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {TECH_KEYS.map((key) => (
          <a
            key={key}
            href={t(`Framework.card.${key}.url`)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-row items-center gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground no-underline transition-all duration-150 ease-in-out hover:border-primary/50 hover:shadow-md"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1 text-sm font-semibold text-card-foreground">
                {t(`Framework.card.${key}.name`)}
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </span>
              <span className="text-xs leading-snug text-muted-foreground">
                {t(`Framework.card.${key}.description`)}
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
