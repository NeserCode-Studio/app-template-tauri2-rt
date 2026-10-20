import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Layers3,
  LockKeyhole,
  Plus,
  Save,
  Settings2,
  Trash2,
  X,
} from "lucide-react";

import { useI18n, useToast } from "@/composables";
import { useCodex } from "@/contexts/codex";
import {
  FIELD_KINDS,
  fieldHint,
  fieldLabel,
  relationLabel,
  typeLabel,
  type FieldKind,
  type FieldTemplate,
  type RelationVocab,
  type TypeConfig,
} from "@/services/codex";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TYPE_ICON_OPTIONS, TypeGlyph } from "./TypeGlyph";

function replaceField(
  fields: FieldTemplate[],
  index: number,
  field: FieldTemplate
): FieldTemplate[] {
  return fields.map((item, itemIndex) => (itemIndex === index ? field : item));
}

function reorder<T>(items: T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function FieldRow({
  typeId,
  field,
  index,
  total,
  typeConfigs,
  onChange,
  onMove,
  onDelete,
}: {
  typeId: string;
  field: FieldTemplate;
  index: number;
  total: number;
  typeConfigs: TypeConfig[];
  onChange: (field: FieldTemplate) => void;
  onMove: (offset: number) => void;
  onDelete: () => void;
}) {
  const { t, lang } = useI18n();
  const label = fieldLabel(typeId, field, lang);
  const hint = fieldHint(typeId, field, lang);
  return (
    <div className="bg-muted/15 grid grid-cols-[minmax(0,1fr)_6rem_auto] items-start gap-2 rounded-md border px-2.5 py-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
      <div className="flex min-w-0 flex-col gap-1.5">
        <Input
          value={label}
          className="h-8 text-sm"
          placeholder={t("Codex.type.fieldLabel")}
          onChange={(event) =>
            onChange({ ...field, label: event.target.value })
          }
        />
        {field.kind === "ref" || field.kind === "refs" ? (
          <Select
            value={field.targetTypeId ?? "__any"}
            onValueChange={(value) =>
              onChange({
                ...field,
                targetTypeId: value === "__any" ? undefined : value,
              })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any">{t("Codex.type.anyType")}</SelectItem>
              {typeConfigs.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {typeLabel(type, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : field.kind === "select" ? (
          <Input
            value={field.options.join(", ")}
            className="h-8 text-xs"
            placeholder={t("Codex.type.options")}
            onChange={(event) =>
              onChange({
                ...field,
                options: event.target.value
                  .split(/[,，、]/)
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
          />
        ) : null}
        <Input
          value={hint}
          className="h-8 text-xs"
          placeholder={t("Codex.type.fieldHint")}
          onChange={(event) =>
            onChange({ ...field, hint: event.target.value || undefined })
          }
        />
      </div>
      <Select
        value={field.kind}
        onValueChange={(value) =>
          onChange({
            ...field,
            kind: value as FieldKind,
            targetTypeId:
              value === "ref" || value === "refs"
                ? field.targetTypeId
                : undefined,
          })
        }
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FIELD_KINDS.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {t(`Codex.kind.${kind}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          aria-label={t("Codex.type.moveUp")}
        >
          <ArrowUp className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={index === total - 1}
          onClick={() => onMove(1)}
          aria-label={t("Codex.type.moveDown")}
        >
          <ArrowDown className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive size-7"
          disabled={field.builtin}
          onClick={onDelete}
          title={
            field.builtin
              ? t("Codex.type.builtinFieldLocked")
              : t("Codex.type.deleteField")
          }
          aria-label={
            field.builtin
              ? t("Codex.type.builtinFieldLocked")
              : t("Codex.type.deleteField")
          }
        >
          {field.builtin ? (
            <LockKeyhole className="size-3" />
          ) : (
            <X className="size-3" />
          )}
        </Button>
      </div>
    </div>
  );
}

function RelationGroupEditor({
  vocab,
  typeConfigs,
  onChange,
  onDelete,
}: {
  vocab: RelationVocab;
  typeConfigs: TypeConfig[];
  onChange: (vocab: RelationVocab) => void;
  onDelete: () => void;
}) {
  const { t, lang } = useI18n();
  const targetType = typeConfigs.find((type) => type.id === vocab.targetTypeId);
  return (
    <div className="bg-muted/15 flex flex-col gap-1.5 rounded-md border p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">
          {typeLabel(targetType, t) || vocab.targetTypeId}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive ml-auto size-6"
          onClick={onDelete}
          aria-label={t("Codex.type.deleteRelationGroup")}
        >
          <X className="size-3" />
        </Button>
      </div>
      {vocab.kinds.map((pair, index) => (
        <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
          <Input
            value={relationLabel(pair.kind, lang)}
            className="h-8 text-xs"
            placeholder={t("Codex.relation.forward")}
            onChange={(event) => {
              const kinds = vocab.kinds.map((item, itemIndex) =>
                itemIndex === index
                  ? { ...item, kind: event.target.value }
                  : item
              );
              onChange({ ...vocab, kinds });
            }}
          />
          <Input
            value={relationLabel(pair.inverseKind, lang)}
            className="h-8 text-xs"
            placeholder={t("Codex.relation.inverse")}
            onChange={(event) => {
              const kinds = vocab.kinds.map((item, itemIndex) =>
                itemIndex === index
                  ? { ...item, inverseKind: event.target.value }
                  : item
              );
              onChange({ ...vocab, kinds });
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive size-7"
            onClick={() =>
              onChange({
                ...vocab,
                kinds: vocab.kinds.filter(
                  (_, itemIndex) => itemIndex !== index
                ),
              })
            }
            aria-label={t("Codex.relation.remove")}
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground h-7 self-start px-1.5 text-xs"
        onClick={() =>
          onChange({
            ...vocab,
            kinds: [
              ...vocab.kinds,
              {
                kind: t("Codex.relation.defaultForward"),
                inverseKind: t("Codex.relation.defaultInverse"),
              },
            ],
          })
        }
      >
        <Plus className="size-3" />
        {t("Codex.type.addRelationPair")}
      </Button>
    </div>
  );
}

export function CodexTypeManager({
  open,
  onOpenChange,
  onTypeCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTypeCreated?: (typeId: string) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { entries, typeConfigs, colorOf, createType, saveType, removeType } =
    useCodex();
  const [selectedId, setSelectedId] = useState(typeConfigs[0]?.id ?? "");
  const [draft, setDraft] = useState<TypeConfig | null>(null);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newTargetTypeId, setNewTargetTypeId] = useState("");
  const [pendingDelete, setPendingDelete] = useState(false);

  const builtinTypes = useMemo(
    () => typeConfigs.filter((type) => type.builtin),
    [typeConfigs]
  );
  const customTypes = useMemo(
    () => typeConfigs.filter((type) => !type.builtin),
    [typeConfigs]
  );
  const selected =
    typeConfigs.find((type) => type.id === selectedId) ??
    typeConfigs[0] ??
    null;

  useEffect(() => {
    if (!open) return;
    const current =
      typeConfigs.find((type) => type.id === selectedId) ??
      typeConfigs[0] ??
      null;
    if (current && current.id !== selectedId) setSelectedId(current.id);
    setDraft(current);
    setNewTargetTypeId("");
  }, [open, selectedId, typeConfigs]);

  const dirty =
    Boolean(draft && selected) &&
    JSON.stringify(draft) !== JSON.stringify(selected);

  function updateField(index: number, field: FieldTemplate) {
    if (!draft) return;
    setDraft({
      ...draft,
      fields: replaceField(draft.fields, index, field),
    });
  }

  function addField() {
    if (!draft) return;
    const field: FieldTemplate = {
      key: `field-${crypto.randomUUID().slice(0, 8)}`,
      label: t("Codex.type.newField"),
      kind: "text",
      options: [],
      order: draft.fields.length,
      builtin: false,
    };
    setDraft({ ...draft, fields: [...draft.fields, field] });
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.label.trim() && !draft.labelKey) {
      toast.error("Codex.type.labelRequired");
      return;
    }
    try {
      const saved = await saveType({
        ...draft,
        fields: draft.fields.map((field, index) => ({
          ...field,
          order: index,
        })),
        relationVocab: draft.relationVocab.filter(
          (vocab) =>
            vocab.kinds.length &&
            vocab.kinds.every(
              (pair) => pair.kind.trim() && pair.inverseKind.trim()
            )
        ),
      });
      if (saved) setDraft(saved);
      toast.success("Codex.type.saved");
    } catch {
      toast.error("Codex.type.saveFailed");
    }
  }

  async function submitCreate() {
    const label = newLabel.trim();
    if (!label) return;
    try {
      const type = await createType({ label });
      if (!type) return;
      setSelectedId(type.id);
      setDraft(type);
      setNewLabel("");
      setCreating(false);
      onTypeCreated?.(type.id);
    } catch {
      toast.error("Codex.type.saveFailed");
    }
  }

  const missingTargets = typeConfigs.filter(
    (type) =>
      !draft?.relationVocab.some((vocab) => vocab.targetTypeId === type.id)
  );
  const selectedIcon =
    TYPE_ICON_OPTIONS.find((option) => option.value === draft?.icon) ??
    TYPE_ICON_OPTIONS[TYPE_ICON_OPTIONS.length - 1];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(82vh,780px)] w-[min(1040px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden bg-neutral-50 p-0 sm:max-w-none dark:bg-neutral-700">
        <DialogHeader className="shrink-0 border-b py-2.5 pr-12 pl-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings2 className="size-4" />
            {t("Codex.type.manage")}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {t("Codex.type.manageHint")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <aside className="flex max-h-44 w-full shrink-0 flex-col border-b bg-neutral-100/55 sm:max-h-none sm:w-52 sm:border-r sm:border-b-0 dark:bg-neutral-800/35">
            <div className="scrollbar-app min-h-0 flex-1 overflow-y-auto p-2">
              <p className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-semibold">
                {t("Codex.type.builtinSection")}
              </p>
              {builtinTypes.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  aria-pressed={selectedId === type.id}
                  onClick={() => setSelectedId(type.id)}
                  className={[
                    "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors",
                    selectedId === type.id
                      ? "border-primary/30 bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent/55 hover:text-foreground border-transparent",
                  ].join(" ")}
                >
                  <TypeGlyph icon={type.icon} className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate">
                    {typeLabel(type, t)}
                  </span>
                  <LockKeyhole className="size-2.5 opacity-50" />
                </button>
              ))}

              <div className="mt-3 flex items-center justify-between px-2 pb-1">
                <p className="text-muted-foreground text-[11px] font-semibold">
                  {t("Codex.type.customSection")}
                </p>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground flex size-5 items-center justify-center rounded hover:bg-neutral-100 dark:hover:bg-neutral-800/50"
                  aria-label={t("Codex.type.new")}
                  onClick={() => setCreating(true)}
                >
                  <Plus className="size-3" />
                </button>
              </div>
              {customTypes.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  aria-pressed={selectedId === type.id}
                  onClick={() => setSelectedId(type.id)}
                  className={[
                    "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors",
                    selectedId === type.id
                      ? "border-primary/30 bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent/55 hover:text-foreground border-transparent",
                  ].join(" ")}
                >
                  <TypeGlyph icon={type.icon} className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate">
                    {typeLabel(type, t)}
                  </span>
                  <span className="text-muted-foreground/60 text-[11px] tabular-nums">
                    {entries.filter((entry) => entry.typeId === type.id).length}
                  </span>
                </button>
              ))}
              {!customTypes.length ? (
                <p className="text-muted-foreground/60 px-2 py-2 text-xs leading-relaxed">
                  {t("Codex.type.noCustom")}
                </p>
              ) : null}

              {creating ? (
                <div className="mt-1 flex flex-col gap-1 rounded-md border bg-neutral-100/70 p-2 dark:bg-neutral-800/40">
                  <Input
                    autoFocus
                    value={newLabel}
                    placeholder={t("Codex.type.namePlaceholder")}
                    className="h-8 text-sm"
                    onChange={(event) => setNewLabel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return;
                      if (event.key === "Enter") void submitCreate();
                      if (event.key === "Escape") setCreating(false);
                    }}
                  />
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      className="h-7 flex-1 text-xs"
                      disabled={!newLabel.trim()}
                      onClick={() => void submitCreate()}
                    >
                      {t("Codex.create")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setCreating(false)}
                    >
                      {t("Editor.chapter.cancelRename")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </aside>

          <div className="scrollbar-app min-w-0 flex-1 overflow-y-auto">
            {draft ? (
              <div className="flex flex-col">
                <div className="flex items-center gap-3 border-b px-4 py-2.5">
                  <span
                    className="bg-muted flex size-9 items-center justify-center rounded-lg"
                    style={{ color: colorOf(draft.id) }}
                  >
                    <TypeGlyph icon={draft.icon} className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate text-base font-semibold">
                        {typeLabel(draft, t)}
                      </h3>
                      <Badge variant="outline" className="h-5 text-[11px]">
                        {draft.builtin
                          ? t("Codex.type.builtin")
                          : t("Codex.type.custom")}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {draft.fields.length} {t("Codex.fields")} ·{" "}
                      {
                        entries.filter((entry) => entry.typeId === draft.id)
                          .length
                      }{" "}
                      {t("Codex.entries")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!dirty}
                    onClick={() => void saveDraft()}
                  >
                    {dirty ? (
                      <Save className="size-3.5" />
                    ) : (
                      <Check className="size-3.5" />
                    )}
                    {dirty ? t("Codex.save") : t("Codex.save.saved")}
                  </Button>
                </div>

                <section className="border-b px-4 pb-2.5">
                  <div className="bg-background sticky top-0 z-20 -mx-4 border-b px-4 py-2.5">
                    <h4 className="text-muted-foreground text-xs font-semibold">
                      {t("Codex.type.identity")}
                    </h4>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,1fr)_9rem_auto_auto] md:items-end">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-muted-foreground text-xs">
                        {t("Codex.type.label")}
                      </span>
                      <Input
                        value={draft.label}
                        className="h-8 text-sm"
                        placeholder={
                          draft.labelKey
                            ? t(draft.labelKey)
                            : t("Codex.type.namePlaceholder")
                        }
                        onChange={(event) =>
                          setDraft({ ...draft, label: event.target.value })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-muted-foreground text-xs">
                        {t("Codex.type.icon")}
                      </span>
                      <Select
                        value={draft.icon ?? "shapes"}
                        onValueChange={(icon) => setDraft({ ...draft, icon })}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue>
                            <span className="flex items-center gap-2">
                              <TypeGlyph
                                icon={selectedIcon.value}
                                className="size-4"
                              />
                              <span>{t(selectedIcon.labelKey)}</span>
                            </span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {TYPE_ICON_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <span className="flex items-center gap-2">
                                <TypeGlyph
                                  icon={option.value}
                                  className="size-4"
                                />
                                <span>{t(option.labelKey)}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-muted-foreground text-xs whitespace-nowrap">
                        {t("Codex.type.colorLight")}
                      </span>
                      <input
                        type="color"
                        value={draft.color.light}
                        aria-label={t("Codex.type.colorLight")}
                        className="size-8 cursor-pointer appearance-none overflow-hidden rounded-md border-0 bg-transparent p-0 [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            color: {
                              ...draft.color,
                              light: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-muted-foreground text-xs whitespace-nowrap">
                        {t("Codex.type.colorDark")}
                      </span>
                      <input
                        type="color"
                        value={draft.color.dark}
                        aria-label={t("Codex.type.colorDark")}
                        className="size-8 cursor-pointer appearance-none overflow-hidden rounded-md border-0 bg-transparent p-0 [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            color: { ...draft.color, dark: event.target.value },
                          })
                        }
                      />
                    </label>
                  </div>
                </section>

                <section className="flex flex-col gap-2 border-b px-4 pb-2.5">
                  <div className="bg-background sticky top-0 z-20 -mx-4 flex items-center justify-between gap-3 border-b px-4 py-2.5">
                    <h4 className="text-muted-foreground text-xs font-semibold">
                      {t("Codex.type.fields")}
                    </h4>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={addField}
                    >
                      <Plus className="size-3" />
                      {t("Codex.type.addField")}
                    </Button>
                  </div>
                  <p className="text-muted-foreground/60 text-[11px]">
                    {t("Codex.type.fieldsOrderHint")}
                  </p>
                  {draft.fields.map((field, index) => (
                    <FieldRow
                      key={field.key}
                      typeId={draft.id}
                      field={field}
                      index={index}
                      total={draft.fields.length}
                      typeConfigs={typeConfigs}
                      onChange={(next) => updateField(index, next)}
                      onMove={(offset) =>
                        setDraft({
                          ...draft,
                          fields: reorder(draft.fields, index, offset).map(
                            (item, itemIndex) => ({ ...item, order: itemIndex })
                          ),
                        })
                      }
                      onDelete={() =>
                        setDraft({
                          ...draft,
                          fields: draft.fields
                            .filter((_, itemIndex) => itemIndex !== index)
                            .map((item, itemIndex) => ({
                              ...item,
                              order: itemIndex,
                            })),
                        })
                      }
                    />
                  ))}
                  {!draft.fields.length ? (
                    <p className="text-muted-foreground rounded-md border border-dashed px-3 py-4 text-center text-xs">
                      {t("Codex.type.noFields")}
                    </p>
                  ) : null}
                </section>

                <section className="flex flex-col gap-2 border-b px-4 pb-2.5">
                  <div className="bg-background sticky top-0 z-20 -mx-4 border-b px-4 py-2.5">
                    <h4 className="text-muted-foreground text-xs font-semibold">
                      {t("Codex.type.relationVocab")}
                    </h4>
                  </div>
                  {draft.relationVocab.map((vocab, index) => (
                    <RelationGroupEditor
                      key={vocab.targetTypeId}
                      vocab={vocab}
                      typeConfigs={typeConfigs}
                      onChange={(next) =>
                        setDraft({
                          ...draft,
                          relationVocab: draft.relationVocab.map(
                            (item, itemIndex) =>
                              itemIndex === index ? next : item
                          ),
                        })
                      }
                      onDelete={() =>
                        setDraft({
                          ...draft,
                          relationVocab: draft.relationVocab.filter(
                            (_, itemIndex) => itemIndex !== index
                          ),
                        })
                      }
                    />
                  ))}
                  {missingTargets.length ? (
                    <div className="flex gap-1.5">
                      <Select
                        value={newTargetTypeId}
                        onValueChange={setNewTargetTypeId}
                      >
                        <SelectTrigger className="h-8 flex-1 text-sm">
                          <SelectValue
                            placeholder={t("Codex.type.addTarget")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {missingTargets.map((type) => (
                            <SelectItem key={type.id} value={type.id}>
                              {typeLabel(type, t)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        disabled={!newTargetTypeId}
                        onClick={() => {
                          setDraft({
                            ...draft,
                            relationVocab: [
                              ...draft.relationVocab,
                              {
                                targetTypeId: newTargetTypeId,
                                kinds: [
                                  {
                                    kind: t("Codex.relation.defaultForward"),
                                    inverseKind: t(
                                      "Codex.relation.defaultInverse"
                                    ),
                                  },
                                ],
                              },
                            ],
                          });
                          setNewTargetTypeId("");
                        }}
                      >
                        <Plus className="size-3" />
                        {t("Codex.type.addTarget")}
                      </Button>
                    </div>
                  ) : null}
                </section>

                <section className="px-4 pb-2.5">
                  <div className="bg-background sticky top-0 z-20 -mx-4 flex items-center justify-between gap-3 border-b px-4 py-2.5">
                    <div>
                      <h4 className="text-muted-foreground text-xs font-semibold">
                        {t("Codex.type.danger")}
                      </h4>
                      <p className="text-muted-foreground/70 mt-1 text-xs">
                        {draft.builtin
                          ? t("Codex.type.builtinLocked")
                          : t("Codex.type.deleteHint")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive h-7 shrink-0 text-xs"
                      disabled={draft.builtin}
                      onClick={() => setPendingDelete(true)}
                    >
                      <Trash2 className="size-3.5" />
                      {t("Codex.type.delete")}
                    </Button>
                  </div>
                </section>
              </div>
            ) : (
              <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2">
                <Layers3 className="size-8 opacity-40" />
                <p className="text-xs">{t("Codex.type.manageHint")}</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>

      <AlertDialog open={pendingDelete} onOpenChange={setPendingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Codex.type.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Codex.type.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("Editor.chapter.cancelRename")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!draft) return;
                void removeType(draft.id)
                  .then(() => {
                    setPendingDelete(false);
                    const next = typeConfigs.find(
                      (type) => type.id !== draft.id
                    );
                    setSelectedId(next?.id ?? "");
                  })
                  .catch((error) => {
                    setPendingDelete(false);
                    toast.error(
                      error instanceof Error &&
                        error.message === "CODEX_TYPE_IN_USE"
                        ? "Codex.type.inUse"
                        : "Codex.type.deleteFailed"
                    );
                  });
              }}
            >
              {t("Codex.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
