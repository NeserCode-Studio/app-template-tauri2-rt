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
import {
  ARTICLE_FONT_LABELS,
  UI_FONT_LABELS,
} from "@/contexts/preferences.provider";
import {
  CHAPTER_TURN_THRESHOLD_MAX,
  CHAPTER_TURN_THRESHOLD_MIN,
  CHAPTER_TURN_THRESHOLD_STEP,
  type ArticleFont,
  type UiFont,
  usePreferences,
} from "@/contexts/preferences";

/**
 * 写作偏好面板：段落约定、排版、两级字体与翻章交互。
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
    /*
     * 排版偏好在自然顺序上就是「先字体、再尺寸、最后行为」，
     * 因此按这三组分块，而不是按"界面 / 正文"切成两个对半的大节。
     * 每块内部用 SettingItems 的行式布局，滑块的实时数值贴在同一行
     * 的右侧——原先数值独占一行、控件却散在下面，读起来像三段互不相干的表单。
     */
    <div className="flex flex-col gap-6">
      <PrefsGroup title={t("Prefs.ui.section")}>
        <PrefsRow label={t("Prefs.ui.font")}>
          <Select
            value={prefs.uiFont}
            onValueChange={(v) => setPref("uiFont", v as UiFont)}
          >
            <SelectTrigger className="w-44" dir={isZh ? "rtl" : "ltr"}>
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
        </PrefsRow>

        <PrefsRow label={t("Prefs.ui.fontSize")} value={`${prefs.uiFontSize}px`}>
          <Slider
            value={[prefs.uiFontSize]}
            min={12}
            max={18}
            step={1}
            onValueChange={([v]) => setPref("uiFontSize", v)}
          />
        </PrefsRow>
      </PrefsGroup>

      <PrefsGroup title={t("Prefs.article.section")}>
        <PrefsRow label={t("Prefs.article.font")}>
          <Select
            value={prefs.articleFont}
            onValueChange={(v) => setPref("articleFont", v as ArticleFont)}
          >
            <SelectTrigger className="w-44">
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
        </PrefsRow>

        <PrefsRow label={t("Prefs.article.fontSize")} value={`${prefs.fontSize}px`}>
          <Slider
            value={[prefs.fontSize]}
            min={14}
            max={24}
            step={1}
            onValueChange={([v]) => setPref("fontSize", v)}
          />
        </PrefsRow>

        <PrefsRow
          label={t("Prefs.article.lineHeight")}
          value={prefs.lineHeight.toFixed(1)}
        >
          <Slider
            value={[prefs.lineHeight]}
            min={1.6}
            max={2}
            step={0.1}
            onValueChange={([v]) => setPref("lineHeight", v)}
          />
        </PrefsRow>

        <PrefsRow label={t("Prefs.article.lineWidth")} value={`${prefs.lineWidth}`}>
          <Slider
            value={[prefs.lineWidth]}
            min={30}
            max={50}
            step={1}
            onValueChange={([v]) => setPref("lineWidth", v)}
          />
        </PrefsRow>

        <PrefsRow label={t("Prefs.article.indent")}>
          <Select
            value={String(prefs.indentSpaces)}
            onValueChange={(v) => setPref("indentSpaces", Number(v) as 0 | 2 | 4)}
          >
            <SelectTrigger className="w-44">
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
        </PrefsRow>

        <PrefsRow label={t("Prefs.article.gap")}>
          <Switch
            checked={prefs.paragraphGap}
            onCheckedChange={(v) => setPref("paragraphGap", v)}
          />
        </PrefsRow>

        <PrefsRow label={t("Prefs.article.mentions")}>
          <Switch
            checked={prefs.highlightMentions}
            onCheckedChange={(v) => setPref("highlightMentions", v)}
          />
        </PrefsRow>
      </PrefsGroup>

      <PrefsGroup title={t("Prefs.navigation.section")}>
        <PrefsRow
          label={t("Prefs.navigation.turnThreshold")}
          value={`${prefs.chapterTurnThreshold}px`}
          description={t("Prefs.navigation.turnThresholdHint")}
        >
          <Slider
            value={[prefs.chapterTurnThreshold]}
            min={CHAPTER_TURN_THRESHOLD_MIN}
            max={CHAPTER_TURN_THRESHOLD_MAX}
            step={CHAPTER_TURN_THRESHOLD_STEP}
            aria-label={t("Prefs.navigation.turnThreshold")}
            onValueChange={([v]) => setPref("chapterTurnThreshold", v)}
          />
        </PrefsRow>
      </PrefsGroup>

      {/* ---------- 预览 ---------- */}
      <section className="flex flex-col gap-2">
        <h3 className="row-label">{t("Prefs.article.preview")}</h3>
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

/** 一组相关偏好：标题 + 细分隔线的行列表。 */
function PrefsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="row-label mb-1">{title}</h3>
      <div className="flex flex-col divide-y divide-border/60 rounded-md border border-border/70">
        {children}
      </div>
    </section>
  );
}

/**
 * 一行偏好：左侧标题，右侧控件；`value` 时把实时数值贴在标题后。
 *
 * 滑块默认占满整行会和上面的下拉框（定宽）左右不齐，
 * 因此这里让两者共用同一个右侧栏宽度，扫读时是一条竖线。
 */
function PrefsRow({
  label,
  value,
  description,
  children,
}: {
  label: string;
  value?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-4 px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <Label className="text-sm">{label}</Label>
          {value ? (
            <span className="text-xs text-muted-foreground tabular-nums">{value}</span>
          ) : null}
        </div>
        {description ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex w-44 shrink-0 items-center justify-end">{children}</div>
    </div>
  );
}
