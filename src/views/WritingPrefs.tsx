import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useI18n } from "@/composables";
import { usePreferences } from "@/contexts/preferences";
import {
  ARTICLE_FONT_LABELS,
  UI_FONT_LABELS,
} from "@/contexts/preferences.provider";
import type { ArticleFont, UiFont } from "@/contexts/preferences";

/**
 * 写作偏好面板：计划书 §3.2 的段落约定 + 两级字体设置。
 *
 * 字体分两级：
 * - 软件字体：作用于界面 UI（侧栏、按钮、菜单）
 * - 文章字体：作用于正文卡片与输入框
 */
export default function WritingPrefs() {
  const { t, lang } = useI18n();
  const { prefs, setPref } = usePreferences();
  const isZh = lang === "zh-CN";

  const uiFontItems = (Object.keys(UI_FONT_LABELS) as UiFont[]).map((key) => ({
    value: key,
    label: isZh ? UI_FONT_LABELS[key].zh : UI_FONT_LABELS[key].en,
  }));
  const articleFontItems = (Object.keys(ARTICLE_FONT_LABELS) as ArticleFont[]).map((key) => ({
    value: key,
    label: isZh ? ARTICLE_FONT_LABELS[key].zh : ARTICLE_FONT_LABELS[key].en,
  }));
  const indentItems = [
    { value: "0", label: t("Prefs.indent.none") },
    { value: "2", label: t("Prefs.indent.two") },
    { value: "4", label: t("Prefs.indent.four") },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* ---------- 界面外观 ---------- */}
      <section className="flex flex-col gap-4">
        <h3 className="row-label">{t("Prefs.ui.section")}</h3>

        <div className="flex items-center justify-between gap-4">
          <Label>{t("Prefs.ui.font")}</Label>
          <Select
            value={prefs.uiFont}
            onValueChange={(v) => setPref("uiFont", v as UiFont)}
          >
            <SelectTrigger className="w-48" dir={isZh ? "rtl" : "ltr"}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {uiFontItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  <span style={{ fontFamily: `var(--app-font-ui)` }}>{item.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <Label>{t("Prefs.ui.fontSize")}</Label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {prefs.uiFontSize}px
            </span>
          </div>
          <Slider
            value={[prefs.uiFontSize]}
            min={12}
            max={18}
            step={1}
            onValueChange={([v]) => setPref("uiFontSize", v)}
          />
        </div>
      </section>

      {/* ---------- 正文排版 ---------- */}
      <section className="flex flex-col gap-4">
        <h3 className="row-label">{t("Prefs.article.section")}</h3>

        <div className="flex items-center justify-between gap-4">
          <Label>{t("Prefs.article.font")}</Label>
          <Select
            value={prefs.articleFont}
            onValueChange={(v) => setPref("articleFont", v as ArticleFont)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {articleFontItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  <span style={{ fontFamily: "var(--app-font-article)" }}>{item.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <Label>{t("Prefs.article.fontSize")}</Label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {prefs.fontSize}px
            </span>
          </div>
          <Slider
            value={[prefs.fontSize]}
            min={14}
            max={24}
            step={1}
            onValueChange={([v]) => setPref("fontSize", v)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <Label>{t("Prefs.article.lineHeight")}</Label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {prefs.lineHeight.toFixed(1)}
            </span>
          </div>
          <Slider
            value={[prefs.lineHeight]}
            min={1.6}
            max={2}
            step={0.1}
            onValueChange={([v]) => setPref("lineHeight", v)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <Label>{t("Prefs.article.lineWidth")}</Label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {prefs.lineWidth}
            </span>
          </div>
          <Slider
            value={[prefs.lineWidth]}
            min={30}
            max={50}
            step={1}
            onValueChange={([v]) => setPref("lineWidth", v)}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label>{t("Prefs.article.indent")}</Label>
          <Select
            value={String(prefs.indentSpaces)}
            onValueChange={(v) =>
              setPref("indentSpaces", Number(v) as 0 | 2 | 4)
            }
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {indentItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label>{t("Prefs.article.gap")}</Label>
          <Switch
            checked={prefs.paragraphGap}
            onCheckedChange={(v) => setPref("paragraphGap", v)}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label>{t("Prefs.article.mentions")}</Label>
          <Switch
            checked={prefs.highlightMentions}
            onCheckedChange={(v) => setPref("highlightMentions", v)}
          />
        </div>
      </section>

      {/* ---------- 预览 ---------- */}
      <section className="flex flex-col gap-2">
        <h3 className="row-label">{t("Prefs.article.section")}</h3>
        <div className="article-body prose-article rounded-md border bg-muted/20 p-4">
          <p className="article-paragraph">
            他推开门，风雪扑面而来。远处的灯笼在长街尽头摇晃，像一点将灭未灭的火。
          </p>
          <p className="article-paragraph">
            这一行用于预览排版效果，字号、行高、段首缩进与字体都会随上方设置实时变化。
          </p>
        </div>
      </section>
    </div>
  );
}
