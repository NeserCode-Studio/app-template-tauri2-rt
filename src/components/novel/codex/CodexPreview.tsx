import { BookOpen, Link2, Pencil } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@/composables";
import { useCodex } from "@/contexts/codex";
import { useLibrary } from "@/contexts/library";
import {
  fieldLabel,
  relationLabel,
  typeLabel,
  type Entry,
  type FieldTemplate,
  type FieldValue,
} from "@/services/codex";
import { Button } from "@/components/ui/button";
import { TypeGlyph } from "./TypeGlyph";

function fieldValueText(
  value: FieldValue | undefined,
  entries: Entry[]
): string {
  if (!value) return "";
  if (value.kind === "ref") {
    return entries.find((entry) => entry.id === value.value)?.name ?? "";
  }
  if (value.kind === "refs") {
    return value.value
      .map((id) => entries.find((entry) => entry.id === id)?.name)
      .filter((name): name is string => Boolean(name))
      .join("、");
  }
  if (value.kind === "number") return `${value.value}`;
  return value.value;
}

function hasFieldValue(value: FieldValue | undefined): boolean {
  if (!value) return false;
  if (value.kind === "refs") return value.value.length > 0;
  if (value.kind === "ref") return Boolean(value.value);
  if (value.kind === "number") return Number.isFinite(value.value);
  return Boolean(value.value.trim());
}

function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t px-4 py-3">
      <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
      {children}
    </section>
  );
}

export function CodexPreview({
  entry,
  onEdit,
  onSelectEntry,
}: {
  entry: Entry | null;
  onEdit: () => void;
  onSelectEntry: (entryId: string) => void;
}) {
  const { lang, t } = useI18n();
  const { works } = useLibrary();
  const { entries, relations, mentions, typeConfigs, colorOf } = useCodex();

  if (!entry) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <BookOpen className="size-6 opacity-50" />
        <p className="text-sm font-medium">{t("Codex.preview.empty")}</p>
        <p className="text-xs leading-relaxed">
          {t("Codex.preview.emptyHint")}
        </p>
      </div>
    );
  }

  const type = typeConfigs.find((item) => item.id === entry.typeId) ?? null;
  const fields = (type?.fields ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((field) => hasFieldValue(entry.fields[field.key]));
  const linked = relations
    .filter(
      (relation) =>
        relation.fromId === entry.id || relation.toId === entry.id
    )
    .map((relation) => {
      const outgoing = relation.fromId === entry.id;
      const otherId = outgoing ? relation.toId : relation.fromId;
      return {
        id: relation.id,
        kind: outgoing ? relation.kind : relation.inverseKind,
        other: entries.find((item) => item.id === otherId) ?? null,
      };
    })
    .filter(
      (
        item
      ): item is {
        id: string;
        kind: string;
        other: Entry;
      } => Boolean(item.other)
    );
  const scopedTitles =
    entry.scope.kind === "works"
      ? entry.scope.workIds
          .map((id) => works[id]?.title)
          .filter((title): title is string => Boolean(title))
          .slice(0, 2)
      : [];
  const scopeLabel =
    entry.scope.kind === "workspace"
      ? t("Codex.scope.workspace")
      : scopedTitles.join("、") ||
        t("Codex.scope.worksCount").replace(
          "{count}",
          String(entry.scope.workIds.length)
        );
  const mentionCount = mentions[entry.id]?.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="bg-muted flex size-7 items-center justify-center rounded-md"
            style={{ color: colorOf(entry.typeId) }}
          >
            <TypeGlyph icon={type?.icon} className="size-3.5" />
          </span>
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
            {typeLabel(type, t)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("Codex.edit")}
            title={t("Codex.edit")}
            onClick={onEdit}
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
        <h2
          className="mt-2 text-base leading-tight font-semibold"
          style={{ color: colorOf(entry.typeId) }}
        >
          {entry.name}
        </h2>
      </header>

      <div className="scrollbar-app min-h-0 flex-1 overflow-y-auto">
        <section className="px-4 py-3">
          <p className="text-muted-foreground line-clamp-4 text-[13px] leading-relaxed">
            {entry.summary || t("Codex.summaryEmpty")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]">
              {scopeLabel}
            </span>
            {entry.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="bg-muted text-muted-foreground max-w-28 truncate rounded px-1.5 py-0.5 text-[11px]"
              >
                {tag}
              </span>
            ))}
          </div>
          {entry.aliases.length ? (
            <p className="text-muted-foreground mt-2 line-clamp-2 text-[11px] leading-relaxed">
              {entry.aliases.join(" / ")}
            </p>
          ) : null}
        </section>

        {fields.length ? (
          <PreviewSection title={t("Codex.fields")}>
            <dl className="flex flex-col gap-2">
              {fields.map((field: FieldTemplate) => (
                <div key={field.key} className="grid grid-cols-[5.5rem_1fr] gap-2">
                  <dt className="text-muted-foreground truncate text-[11px]">
                    {fieldLabel(entry.typeId, field, lang)}
                  </dt>
                  <dd className="line-clamp-3 text-[13px] leading-relaxed">
                    {fieldValueText(entry.fields[field.key], entries)}
                  </dd>
                </div>
              ))}
            </dl>
          </PreviewSection>
        ) : null}

        {entry.body ? (
          <PreviewSection title={t("Codex.body")}>
            <p className="text-muted-foreground line-clamp-6 whitespace-pre-wrap text-[13px] leading-5">
              {entry.body}
            </p>
          </PreviewSection>
        ) : null}

        {linked.length ? (
          <PreviewSection title={t("Codex.relations")}>
            <div className="flex flex-col gap-1">
              {linked.slice(0, 5).map(({ id, kind, other }) => (
                <button
                  key={id}
                  type="button"
                  className="hover:bg-accent/55 flex min-w-0 items-center gap-1.5 rounded px-1 py-1 text-left"
                  onClick={() => onSelectEntry(other.id)}
                >
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: colorOf(other.typeId) }}
                  />
                  <span className="text-muted-foreground w-14 shrink-0 truncate text-[11px]">
                    {relationLabel(kind, lang)}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-xs"
                    style={{ color: colorOf(other.typeId) }}
                  >
                    {other.name}
                  </span>
                </button>
              ))}
              {linked.length > 5 ? (
                <span className="text-muted-foreground/70 flex items-center gap-1 px-1 text-[11px]">
                  <Link2 className="size-3" />
                  +{linked.length - 5}
                </span>
              ) : null}
            </div>
          </PreviewSection>
        ) : null}

        <PreviewSection title={t("Codex.mentions.chapters")}>
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <BookOpen className="size-3.5" />
            <span className="text-foreground font-medium tabular-nums">
              {mentionCount}
            </span>
            {t("Codex.mentions.short")}
          </p>
        </PreviewSection>
      </div>
    </div>
  );
}
