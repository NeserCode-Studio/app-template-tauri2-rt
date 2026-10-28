import { Check, Plus, X } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/composables";
import { useCodex } from "@/contexts/codex";
import {
  fieldHint,
  fieldLabel,
  typeLabel,
  type Entry,
  type FieldTemplate,
  type FieldValue,
} from "@/services/codex";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

function fieldValueText(value: FieldValue | undefined): string {
  if (!value) return "";
  if (value.kind === "refs") return `${value.value.length}`;
  if (value.kind === "ref") return value.value ? "1" : "0";
  if (value.kind === "number") return `${value.value}`;
  return value.value;
}

function ReferenceField({
  multiple,
  value,
  targetTypeId,
  onValueChange,
}: {
  multiple: boolean;
  value: FieldValue | undefined;
  targetTypeId?: string;
  onValueChange: (value: FieldValue) => void;
}) {
  const { t } = useI18n();
  const { entries, typeConfigs, colorOf } = useCodex();
  const [open, setOpen] = useState(false);
  const selectedIds =
    value?.kind === "refs"
      ? value.value
      : value?.kind === "ref" && value.value
        ? [value.value]
        : [];
  const selected = selectedIds
    .map((id) => entries.find((entry) => entry.id === id))
    .filter((entry): entry is Entry => Boolean(entry));
  const candidates = entries
    .filter((entry) => !targetTypeId || entry.typeId === targetTypeId)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

  function toggle(id: string) {
    if (multiple) {
      const next = selectedIds.includes(id)
        ? selectedIds.filter((item) => item !== id)
        : [...selectedIds, id];
      onValueChange({ kind: "refs", value: next });
      return;
    }
    onValueChange({ kind: "ref", value: id });
    setOpen(false);
  }

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-md border bg-neutral-100/70 px-2 py-1 dark:bg-neutral-800/40">
      {selected.map((entry) => (
        <span
          key={entry.id}
          className="bg-muted inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs"
        >
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: colorOf(entry.typeId) }}
          />
          <span className="truncate">{entry.name}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("Codex.field.removeRef")}
            onClick={() => {
              if (multiple) {
                onValueChange({
                  kind: "refs",
                  value: selectedIds.filter((id) => id !== entry.id),
                });
              } else {
                onValueChange({ kind: "ref", value: "" });
              }
            }}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-7 px-1.5 text-xs"
          >
            <Plus className="size-3" />
            {selected.length
              ? t("Codex.field.addRef")
              : t("Codex.field.chooseRef")}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[min(20rem,calc(100vw-2rem))] p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder={t("Codex.searchShort")} />
            <CommandList>
              <CommandEmpty>{t("Codex.empty")}</CommandEmpty>
              {candidates.map((entry) => {
                const type = typeConfigs.find(
                  (item) => item.id === entry.typeId
                );
                const active = selectedIds.includes(entry.id);
                return (
                  <CommandItem
                    key={entry.id}
                    value={`${entry.name} ${entry.aliases.join(" ")}`}
                    onSelect={() => toggle(entry.id)}
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: colorOf(entry.typeId) }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {entry.name}
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      {typeLabel(type, t)}
                    </span>
                    {active ? <Check className="size-3.5" /> : null}
                  </CommandItem>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function FieldEditor({
  field,
  hint,
  value,
  onChange,
}: {
  field: FieldTemplate;
  hint: string;
  value: FieldValue | undefined;
  onChange: (value: FieldValue | undefined) => void;
}) {
  if (field.kind === "ref" || field.kind === "refs") {
    return (
      <ReferenceField
        multiple={field.kind === "refs"}
        value={value}
        targetTypeId={field.targetTypeId}
        onValueChange={onChange}
      />
    );
  }

  if (field.kind === "longtext") {
    return (
      <Textarea
        value={fieldValueText(value)}
        rows={3}
        className="min-h-20 resize-y text-sm leading-relaxed"
        placeholder={hint || undefined}
        onChange={(event) =>
          onChange({ kind: "longtext", value: event.target.value })
        }
      />
    );
  }

  if (field.kind === "select") {
    const current =
      value?.kind === "select" ? value.value : fieldValueText(value);
    return (
      <select
        value={current}
        className="focus:border-ring h-8 w-full rounded-md border bg-neutral-100/70 px-2 text-sm outline-none dark:bg-neutral-800/40"
        onChange={(event) =>
          onChange({ kind: "select", value: event.target.value })
        }
      >
        <option value="">-</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <Input
      type={field.kind === "number" ? "number" : "text"}
      value={fieldValueText(value)}
      className="h-8 text-sm"
      placeholder={hint || undefined}
      onChange={(event) => {
        if (field.kind === "number") {
          onChange(
            event.target.value === ""
              ? undefined
              : { kind: "number", value: Number(event.target.value) }
          );
          return;
        }
        onChange({
          kind: field.kind,
          value: event.target.value,
        } as FieldValue);
      }}
    />
  );
}

export function CodexFieldItem({
  field,
  typeId,
  value,
  onChange,
}: {
  field: FieldTemplate;
  typeId: string;
  value: FieldValue | undefined;
  onChange: (value: FieldValue | undefined) => void;
}) {
  const { lang, t } = useI18n();
  const hint = fieldHint(typeId, field, lang);
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-muted-foreground flex items-center justify-between gap-2 text-xs font-medium">
        <span>{fieldLabel(typeId, field, lang)}</span>
        {field.kind === "ref" || field.kind === "refs" ? (
          <span className="text-muted-foreground/60 text-[11px]">
            {field.kind === "refs"
              ? t("Codex.field.multiRef")
              : t("Codex.field.singleRef")}
          </span>
        ) : null}
      </span>
      <FieldEditor
        field={field}
        hint={hint}
        value={value}
        onChange={onChange}
      />
      {hint ? (
        <span className="text-muted-foreground/60 text-[11px]">{hint}</span>
      ) : null}
    </label>
  );
}
