import { TitleContext } from "@/contexts/title";
import { useLocalStorageState } from "ahooks";
import { useContext, useMemo, useState } from "react";
import { useI18n, useToast } from "@/composables";
import {
  SettingInputItem,
  SettingOptionalItem,
  SettingSelectItem,
} from "@/components/SettingItems";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Clock, History, Trash2 } from "lucide-react";

import type { SettingSelectItemItem } from "@/shared";

/** 设置项索引：供搜索与「最近修改」跳转使用 */
interface SettingIndexItem {
  id: string;
  group: string;
  labelKey: string;
  keywords: string[];
}

const SETTING_INDEX: SettingIndexItem[] = [
  {
    id: "title",
    group: "general",
    labelKey: "Settings.items.title.title",
    keywords: ["title", "window", "标题", "窗口"],
  },
  {
    id: "lang",
    group: "general",
    labelKey: "Settings.items.lang.title",
    keywords: ["lang", "language", "i18n", "语言"],
  },
  {
    id: "auto-complete",
    group: "general",
    labelKey: "Settings.items.auto-complete.title",
    keywords: ["auto", "complete", "自动补全", "补全"],
  },
];

interface ChangedRecord {
  id: string;
  label: string;
  group: string;
  at: number;
}

const MAX_HISTORY = 8;

export default function Settings() {
  const { t, setLang, lang } = useI18n();
  const { title, setTitle } = useContext(TitleContext);
  const [autoComplete, setAutoComplete] = useLocalStorageState(
    "use-auto-complete",
    {
      defaultValue: true,
    }
  );
  const { success, error } = useToast({
    duration: 2000,
  });

  /* 搜索历史 + 修改记录（localStorage 持久化） */
  const [searchHistory, setSearchHistory] = useLocalStorageState<string[]>(
    "settings-search-history",
    { defaultValue: [] }
  );
  const [changedRecords, setChangedRecords] = useLocalStorageState<
    ChangedRecord[]
  >("settings-changed-history", { defaultValue: [] });

  const history = searchHistory ?? [];
  const changed = changedRecords ?? [];

  /* 搜索状态 */
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("search");

  const recordChange = (id: string, labelKey: string) => {
    const meta = SETTING_INDEX.find((item) => item.id === id);
    const record: ChangedRecord = {
      id,
      label: t(labelKey),
      group: meta?.group ?? "general",
      at: Date.now(),
    };
    setChangedRecords((prev) => {
      const list = prev ?? [];
      return [record, ...list.filter((r) => r.id !== id)].slice(0, MAX_HISTORY);
    });
  };

  const recordSearch = (term: string) => {
    const s = term.trim();
    if (!s) return;
    setSearchHistory((prev) => {
      const list = prev ?? [];
      return [s, ...list.filter((x) => x !== s)].slice(0, MAX_HISTORY);
    });
  };

  const clearHistory = () => {
    setSearchHistory([]);
    setChangedRecords([]);
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SETTING_INDEX.filter((item) => {
      const label = t(item.labelKey).toLowerCase();
      return (
        label.includes(q) ||
        item.keywords.some((k) => k.toLowerCase().includes(q))
      );
    });
  }, [query, t]);

  const jumpTo = (group: string) => {
    setActiveTab(group);
    setQuery("");
  };

  /* setting title item */
  const titleAction = (data: FormData) => {
    if (!data || !data.get("input") || data.get("input") === title)
      return error("Settings.items.title.error");
    setTitle(data.get("input") as string);
    recordChange("title", "Settings.items.title.title");
    success("Settings.items.title.success");
  };

  /* setting lang item */
  const langItems: SettingSelectItemItem[] = [
    {
      value: "en-US",
      label: "English(US)",
    },
    {
      value: "zh-CN",
      label: "简体中文",
    },
  ];
  const langAction = (data: FormData) => {
    if (!data || !data.get("select") || data.get("select") === lang)
      return error("Settings.items.lang.error");

    setLang(data.get("select") as string);
    recordChange("lang", "Settings.items.lang.title");
    success("Settings.items.lang.success");
  };

  /* setting auto-complete item */
  const autoCompleteAction = (checked: boolean) => {
    setAutoComplete(checked);
    recordChange("auto-complete", "Settings.items.auto-complete.title");
    success("Settings.items.auto-complete.success");
  };

  return (
    <div className="view-settings">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="search" className="flex-none">
            {t("Settings.tabs.search")}
          </TabsTrigger>
          <TabsTrigger value="general" className="flex-none">
            {t("Settings.tabs.general")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="search">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {t("Settings.search.description")}
            </p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") recordSearch(query);
                }}
                placeholder={t("Settings.search.placeholder")}
                className="pl-8"
              />
            </div>

            {query.trim() ? (
              <div className="flex flex-col gap-0.5">
                {results.length ? (
                  results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        recordSearch(query);
                        jumpTo(r.group);
                      }}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      {t(r.labelKey)}
                    </button>
                  ))
                ) : (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">
                    {t("Settings.search.empty")}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {history.length || changed.length ? (
                  <>
                    {history.length ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          {t("Settings.search.history")}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {history.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setQuery(s)}
                              className="rounded-md bg-muted px-2 py-1 text-xs transition-colors hover:bg-accent"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {changed.length ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <History className="h-3.5 w-3.5" />
                          {t("Settings.search.changed")}
                        </div>
                        <div className="flex flex-col gap-0.5">
                          {changed.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => jumpTo(r.group)}
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                            >
                              {r.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearHistory}
                      className="self-start text-muted-foreground"
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("Settings.search.clear")}
                    </Button>
                  </>
                ) : (
                  <p className="px-2 py-4 text-sm text-muted-foreground">
                    {t("Settings.search.noHistory")}
                  </p>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="general">
          <div className="flex flex-col gap-5">
            <p className="text-sm text-muted-foreground">
              {t("Settings.general.description")}
            </p>
            <SettingInputItem
              type="text"
              value={title ?? ""}
              placeholder={t("Settings.items.title.placeholder")}
              onItemSubmit={titleAction}
              title={t("Settings.items.title.title")}
              description={t("Settings.items.title.description")}
              autoComplete={autoComplete}
            />
            <SettingSelectItem
              items={langItems}
              value={langItems.find((i) => i.value === lang)}
              label={t("Settings.items.lang.label")}
              placeholder={t("Settings.items.select.default.placeholder")}
              onItemSubmit={langAction}
              title={t("Settings.items.lang.title")}
              description={t("Settings.items.lang.description")}
            />
            <SettingOptionalItem
              label={t("Settings.items.auto-complete.label")}
              value={autoComplete}
              id="optional.auto-complete"
              onItemChange={autoCompleteAction}
              title={t("Settings.items.auto-complete.title")}
              description={t("Settings.items.auto-complete.description")}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
