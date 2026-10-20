import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { useI18n, useToast } from "@/composables";
import { useCodex } from "@/contexts/codex";
import {
  typeLabel,
  type Entry,
  type FieldValue,
} from "@/services/codex";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CodexFieldItem } from "./CodexFieldItem";
import { TypeGlyph } from "./TypeGlyph";

function parseList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，、]/)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

interface CodexEntryCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTypeId?: string;
  onCreated?: (entry: Entry) => void;
}

export function CodexEntryCreateDialog({
  open,
  onOpenChange,
  initialTypeId,
  onCreated,
}: CodexEntryCreateDialogProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { typeConfigs, create, save, colorOf } = useCodex();
  const fallbackTypeId = typeConfigs[0]?.id ?? "";
  const [typeId, setTypeId] = useState(initialTypeId || fallbackTypeId);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [aliases, setAliases] = useState("");
  const [tags, setTags] = useState("");
  const [body, setBody] = useState("");
  const [fields, setFields] = useState<Record<string, FieldValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const selectedType =
    typeConfigs.find((type) => type.id === typeId) ?? typeConfigs[0] ?? null;
  const fieldList = useMemo(
    () => selectedType?.fields.slice().sort((a, b) => a.order - b.order) ?? [],
    [selectedType]
  );

  useEffect(() => {
    if (!open) return;
    const nextType =
      initialTypeId &&
      typeConfigs.some((type) => type.id === initialTypeId)
        ? initialTypeId
        : fallbackTypeId;
    setTypeId(nextType);
    setName("");
    setSummary("");
    setAliases("");
    setTags("");
    setBody("");
    setFields({});
    setAttempted(false);
  }, [fallbackTypeId, initialTypeId, open, typeConfigs]);

  function changeType(nextTypeId: string) {
    setTypeId(nextTypeId);
    setFields({});
  }

  async function submit() {
    const trimmedName = name.trim();
    setAttempted(true);
    if (!selectedType || !trimmedName || submitting) return;
    setSubmitting(true);
    try {
      const created = await create(selectedType.id, trimmedName);
      if (!created) return;
      const next: Entry = {
        ...created,
        name: trimmedName,
        summary: summary.trim(),
        aliases: parseList(aliases),
        tags: parseList(tags),
        body: body.trim(),
        fields,
      };
      const saved = await save(next);
      const result = saved ?? next;
      onOpenChange(false);
      onCreated?.(result);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message === "CODEX_DUPLICATE_NAME"
          ? "Codex.duplicateName"
          : "Codex.saveFailed"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(88vh,760px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
            <DialogTitle className="flex items-center gap-2 text-base">
              <span
                className="bg-muted flex size-7 items-center justify-center rounded-md"
                style={{ color: selectedType ? colorOf(selectedType.id) : undefined }}
              >
                <TypeGlyph icon={selectedType?.icon} className="size-3.5" />
              </span>
              {t("Codex.new")}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {t("Codex.createDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="scrollbar-app min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-medium">{t("Codex.type")}</span>
                <Select value={selectedType?.id ?? ""} onValueChange={changeType}>
                  <SelectTrigger aria-label={t("Codex.type")}>
                    <SelectValue placeholder={t("Codex.type")} />
                  </SelectTrigger>
                  <SelectContent>
                    {typeConfigs.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {typeLabel(type, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-medium">
                  {t("Codex.name")}
                  <span className="text-destructive ml-1">*</span>
                </span>
                <Input
                  autoFocus
                  autoComplete="off"
                  value={name}
                  aria-invalid={attempted && !name.trim()}
                  placeholder={t("Codex.name")}
                  onChange={(event) => setName(event.target.value)}
                />
                {attempted && !name.trim() ? (
                  <span className="text-destructive text-[11px]">
                    {t("Codex.nameRequired")}
                  </span>
                ) : null}
              </label>

              <label className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                <span className="text-xs font-medium">{t("Codex.summary")}</span>
                <Input
                  value={summary}
                  placeholder={t("Codex.summaryPlaceholder")}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </label>

              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-medium">{t("Codex.aliases")}</span>
                <Input
                  value={aliases}
                  onChange={(event) => setAliases(event.target.value)}
                />
              </label>

              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-medium">{t("Codex.tags")}</span>
                <Input
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                />
              </label>

              <label className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                <span className="text-xs font-medium">{t("Codex.body")}</span>
                <Textarea
                  value={body}
                  rows={4}
                  className="min-h-24 resize-y text-sm leading-relaxed"
                  placeholder={t("Codex.bodyPlaceholder")}
                  onChange={(event) => setBody(event.target.value)}
                />
              </label>
            </div>

            {fieldList.length ? (
              <section className="mt-5 border-t pt-4">
                <div className="mb-3">
                  <h3 className="text-sm font-medium">
                    {t("Codex.create.typeFields")}
                  </h3>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    {t("Codex.create.typeFieldsHint")}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {fieldList.map((field) => (
                    <div
                      key={field.key}
                      className={[
                        "min-w-0",
                        field.kind === "longtext" || field.kind === "refs"
                          ? "sm:col-span-2"
                          : "",
                      ].join(" ")}
                    >
                      <CodexFieldItem
                        field={field}
                        typeId={selectedType?.id ?? ""}
                        value={fields[field.key]}
                        onChange={(value) => {
                          setFields((current) => {
                            const next = { ...current };
                            if (value === undefined) {
                              delete next[field.key];
                            } else {
                              next[field.key] = value;
                            }
                            return next;
                          });
                        }}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <DialogFooter className="shrink-0 border-t px-5 py-3">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              {t("Editor.chapter.cancelRename")}
            </Button>
            <Button
              type="submit"
              disabled={Boolean(attempted && !name.trim()) || submitting}
            >
              <Plus className="size-3.5" />
              {t("Codex.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
