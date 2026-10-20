import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronLeft,
  ExternalLink,
  Pencil,
  Plus,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import { useNavigate } from "react-router";

import { useI18n, useToast } from "@/composables";
import { useCodex } from "@/contexts/codex";
import { useLibrary } from "@/contexts/library";
import { useOutline } from "@/contexts/outline";
import { useWorkspace } from "@/contexts/workspace";
import {
  loadMentionChapterTitles,
  typeLabel,
  type Entry,
  type FieldTemplate,
  type FieldValue,
  type MentionRecord,
  type RelationKindDef,
  type Scope,
} from "@/services/codex";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { TypeGlyph } from "./TypeGlyph";

type SaveState = "saved" | "dirty" | "saving" | "error";

function parseList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,，、]/)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

function patchField(
  draft: Entry,
  key: string,
  value: FieldValue | undefined
): Entry {
  const fields = { ...draft.fields };
  if (value === undefined) {
    delete fields[key];
  } else {
    fields[key] = value;
  }
  return { ...draft, fields };
}

function valueText(
  value: FieldValue | undefined,
  field: FieldTemplate
): string {
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
    <div className="bg-neutral-100/70 dark:bg-neutral-800/40 flex min-h-8 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1">
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
  value,
  onChange,
}: {
  field: FieldTemplate;
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
        value={valueText(value, field)}
        rows={3}
        className="min-h-20 resize-y text-sm leading-relaxed"
        placeholder={field.hint}
        onChange={(event) =>
          onChange({ kind: "longtext", value: event.target.value })
        }
      />
    );
  }

  if (field.kind === "select") {
    const current =
      value?.kind === "select" ? value.value : valueText(value, field);
    return (
      <select
        value={current}
        className="bg-neutral-100/70 dark:bg-neutral-800/40 focus:border-ring h-8 w-full rounded-md border px-2 text-sm outline-none"
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
      value={valueText(value, field)}
      className="h-8 text-sm"
      placeholder={field.hint}
      onChange={(event) => {
        if (field.kind === "number") {
          onChange(
            event.target.value === ""
              ? undefined
              : { kind: "number", value: Number(event.target.value) }
          );
          return;
        }
        onChange({ kind: field.kind, value: event.target.value } as FieldValue);
      }}
    />
  );
}

function FieldItem({
  field,
  value,
  onChange,
}: {
  field: FieldTemplate;
  value: FieldValue | undefined;
  onChange: (value: FieldValue | undefined) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-muted-foreground flex items-center justify-between gap-2 text-xs font-medium">
        <span>{field.label || field.key}</span>
        {field.kind === "ref" || field.kind === "refs" ? (
          <span className="text-muted-foreground/60 text-[11px]">
            {field.kind === "refs"
              ? t("Codex.field.multiRef")
              : t("Codex.field.singleRef")}
          </span>
        ) : null}
      </span>
      <FieldEditor field={field} value={value} onChange={onChange} />
      {field.hint ? (
        <span className="text-muted-foreground/60 text-[11px]">
          {field.hint}
        </span>
      ) : null}
    </label>
  );
}

function ScopePicker({
  scope,
  onChange,
}: {
  scope: Scope;
  onChange: (scope: Scope) => void;
}) {
  const { t } = useI18n();
  const { works } = useLibrary();
  const [open, setOpen] = useState(false);
  const selectedIds = scope.kind === "works" ? scope.workIds : [];
  const visibleWorks = Object.values(works).filter((work) => !work.archived);
  const label =
    selectedIds.length === 0
      ? t("Codex.scope.workspace")
      : selectedIds.length === 1
        ? (works[selectedIds[0]]?.title ?? selectedIds[0])
        : `${works[selectedIds[0]]?.title ?? selectedIds[0]} +${selectedIds.length - 1}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 max-w-20 px-2 text-xs font-normal sm:max-w-48"
        >
          <BookOpen className="size-3" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(18rem,calc(100vw-2rem))] p-2"
        align="end"
      >
        <button
          type="button"
          className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs"
          onClick={() => onChange({ kind: "workspace" })}
        >
          <span
            className={[
              "flex size-4 items-center justify-center rounded border",
              selectedIds.length === 0
                ? "border-primary bg-primary text-primary-foreground"
                : "",
            ].join(" ")}
          >
            {selectedIds.length === 0 ? <Check className="size-3" /> : null}
          </span>
          {t("Codex.scope.allWorks")}
        </button>
        {visibleWorks.length ? <Separator className="my-1" /> : null}
        <div className="scrollbar-app max-h-64 overflow-y-auto">
          {visibleWorks.map((work) => {
            const checked = selectedIds.includes(work.id);
            return (
              <label
                key={work.id}
                className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) => {
                    const ids = next
                      ? [...selectedIds, work.id]
                      : selectedIds.filter((id) => id !== work.id);
                    onChange(
                      ids.length
                        ? { kind: "works", workIds: ids }
                        : { kind: "workspace" }
                    );
                  }}
                />
                <span className="truncate">{work.title}</span>
              </label>
            );
          })}
        </div>
        {!visibleWorks.length ? (
          <p className="text-muted-foreground px-2 py-3 text-center text-xs">
            {t("Codex.scope.noWorks")}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function RelationComposer({ entry }: { entry: Entry }) {
  const { t } = useI18n();
  const toast = useToast();
  const { entries, relations, typeConfigs, colorOf, addRelation } = useCodex();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [customKind, setCustomKind] = useState("");
  const [customInverse, setCustomInverse] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const sourceType = typeConfigs.find((type) => type.id === entry.typeId);
  const target = entries.find((item) => item.id === targetId);
  const connected = new Set(
    relations
      .filter(
        (relation) => relation.fromId === entry.id || relation.toId === entry.id
      )
      .map((relation) =>
        relation.fromId === entry.id ? relation.toId : relation.fromId
      )
  );
  const candidates = entries.filter(
    (item) => item.id !== entry.id && !connected.has(item.id)
  );
  const pairs =
    sourceType?.relationVocab.find(
      (vocab) => vocab.targetTypeId === target?.typeId
    )?.kinds ?? [];

  const reset = () => {
    setTargetId("");
    setCustomMode(false);
    setCustomKind("");
    setCustomInverse("");
  };

  async function submit(pair: RelationKindDef) {
    if (
      !target ||
      !pair.kind.trim() ||
      !pair.inverseKind.trim() ||
      submitting
    ) {
      return;
    }
    setSubmitting(true);
    try {
      const relation = await addRelation(
        entry.id,
        target.id,
        pair.kind,
        pair.inverseKind
      );
      if (!relation) {
        toast.error("Codex.relation.saveFailed");
        return;
      }
      setOpen(false);
      reset();
    } catch {
      toast.error("Codex.relation.saveFailed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
        >
          <Plus className="size-3" />
          {t("Codex.relation.add")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(24rem,calc(100vw-2rem))] p-0"
        align="start"
      >
        {!target ? (
          <Command>
            <CommandInput placeholder={t("Codex.relation.searchTarget")} />
            <CommandList>
              <CommandEmpty>{t("Codex.empty")}</CommandEmpty>
              {typeConfigs.map((type) => {
                const group = candidates.filter(
                  (item) => item.typeId === type.id
                );
                if (!group.length) return null;
                return (
                  <CommandGroup key={type.id} heading={typeLabel(type, t)}>
                    {group.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={`${item.name} ${item.aliases.join(" ")}`}
                        onSelect={() => {
                          setTargetId(item.id);
                          const first =
                            sourceType?.relationVocab.find(
                              (vocab) => vocab.targetTypeId === item.typeId
                            )?.kinds[0] ?? null;
                          setCustomMode(!first);
                          if (first) {
                            setCustomKind(first.kind);
                            setCustomInverse(first.inverseKind);
                          }
                        }}
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: colorOf(item.typeId) }}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {item.name}
                        </span>
                        <ArrowUpRight className="text-muted-foreground size-3" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
            </CommandList>
          </Command>
        ) : (
          <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="hover:bg-accent flex size-6 items-center justify-center rounded"
                onClick={() => setTargetId("")}
                aria-label={t("Codex.library.back")}
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: colorOf(target.typeId) }}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {target.name}
              </span>
            </div>
            {!customMode && pairs.length ? (
              <div className="flex flex-col gap-1">
                {pairs.map((pair) => (
                  <button
                    key={`${pair.kind}:${pair.inverseKind}`}
                    type="button"
                    disabled={submitting}
                    aria-pressed={
                      customKind === pair.kind &&
                      customInverse === pair.inverseKind
                    }
                    className={[
                      "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors disabled:opacity-60",
                      customKind === pair.kind &&
                      customInverse === pair.inverseKind
                        ? "border-primary/30 bg-accent"
                        : "hover:bg-accent",
                    ].join(" ")}
                    onClick={() => {
                      setCustomKind(pair.kind);
                      setCustomInverse(pair.inverseKind);
                      void submit(pair);
                    }}
                  >
                    <span>{pair.kind}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-muted-foreground">
                      {pair.inverseKind}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className="text-muted-foreground mt-1 self-start text-xs underline-offset-4 hover:underline"
                  onClick={() => setCustomMode(true)}
                >
                  {t("Codex.relation.custom")}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={customKind}
                  placeholder={t("Codex.relation.forward")}
                  className="h-8 text-sm"
                  onChange={(event) => setCustomKind(event.target.value)}
                />
                <Input
                  value={customInverse}
                  placeholder={t("Codex.relation.inverse")}
                  className="h-8 text-sm"
                  onChange={(event) => setCustomInverse(event.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  className="col-span-2 h-8 text-sm"
                  disabled={
                    submitting || !customKind.trim() || !customInverse.trim()
                  }
                  onClick={() =>
                    void submit({
                      kind: customKind,
                      inverseKind: customInverse,
                    })
                  }
                >
                  {t("Codex.relation.confirm")}
                </Button>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t px-4 py-3 first:border-t-0">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="bg-primary/60 h-3.5 w-0.5 rounded-full" />
          <h3 className="text-foreground text-sm font-semibold">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function CodexDetail({
  entry,
  onClose,
}: {
  entry: Entry;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const { root } = useWorkspace();
  const { works } = useLibrary();
  const { openChapter } = useOutline();
  const {
    entries,
    relations,
    mentions,
    typeConfigs,
    setCurrentEntryId,
    save,
    remove,
    removeRelation,
    colorOf,
  } = useCodex();
  const type = typeConfigs.find((item) => item.id === entry.typeId) ?? null;
  const [draft, setDraft] = useState(entry);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(entry.name);
  const [chapterTitles, setChapterTitles] = useState<Record<string, string>>(
    {}
  );
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});

  const mentionRecords = useMemo(
    () => [...(mentions[entry.id] ?? [])],
    [mentions, entry.id]
  );

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!root || !mentionRecords.length) {
      setChapterTitles({});
      return;
    }
    let alive = true;
    void loadMentionChapterTitles(root, mentionRecords).then((next) => {
      if (alive) setChapterTitles(next);
    });
    return () => {
      alive = false;
    };
  }, [root, mentionRecords]);

  const persist = useCallback(
    async (candidate?: Entry) => {
      const next = candidate ?? draftRef.current;
      if (!next.name.trim()) {
        setSaveState("error");
        return;
      }
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setSaveState("saving");
      try {
        await save(next);
        if (draftRef.current === next) {
          dirtyRef.current = false;
          setSaveState("saved");
        } else {
          setSaveState("dirty");
        }
      } catch {
        setSaveState("error");
        toast.error("Codex.saveFailed");
      }
    },
    [save, toast]
  );

  saveRef.current = () => persist();

  useEffect(() => {
    if (!dirtyRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (!draft.name.trim()) {
      setSaveState("error");
      return;
    }
    setSaveState("dirty");
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void saveRef.current();
    }, 600);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [draft]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s")
        return;
      event.preventDefault();
      void saveRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (dirtyRef.current && draftRef.current.name.trim()) {
        void saveRef.current();
      }
    },
    []
  );

  function updateDraft(next: Entry) {
    dirtyRef.current = true;
    draftRef.current = next;
    setDraft(next);
  }

  const fieldList =
    type?.fields.slice().sort((a, b) => a.order - b.order) ?? [];
  const selectionFields = fieldList.filter(
    (field) =>
      field.kind === "ref" || field.kind === "refs" || field.kind === "select"
  );
  const contentFields = fieldList.filter(
    (field) =>
      field.kind !== "ref" && field.kind !== "refs" && field.kind !== "select"
  );
  const linked = relations
    .filter(
      (relation) => relation.fromId === draft.id || relation.toId === draft.id
    )
    .map((relation) => {
      const outgoing = relation.fromId === draft.id;
      const otherId = outgoing ? relation.toId : relation.fromId;
      return {
        relation,
        outgoing,
        kind: outgoing ? relation.kind : relation.inverseKind,
        other: entries.find((item) => item.id === otherId) ?? null,
      };
    })
    .filter((item) => item.other);

  const ownNames = [
    draft.name.trim(),
    ...draft.aliases.map((item) => item.trim()),
  ].filter(Boolean);
  const conflicts = [
    ...new Set(
      ownNames.filter((name) =>
        entries.some(
          (item) =>
            item.id !== draft.id &&
            (item.name.trim() === name ||
              item.aliases.some((alias) => alias.trim() === name))
        )
      )
    ),
  ];
  const saveLabel =
    saveState === "saving"
      ? t("Codex.save.saving")
      : saveState === "dirty"
        ? t("Codex.save.dirty")
        : saveState === "error"
          ? t("Codex.save.error")
          : t("Codex.save.saved");
  const deleteConfirmed =
    Boolean(draft.name.trim()) && deleteConfirmName.trim() === draft.name.trim();

  function jumpToMention(record: MentionRecord) {
    openChapter(record.workId, record.chapterId);
    navigate("/editor");
  }

  function openRenameDialog() {
    setRenameDraft(draft.name);
    setRenameOpen(true);
  }

  function saveRename() {
    const name = renameDraft.trim();
    if (!name) return;
    if (name !== draft.name) updateDraft({ ...draft, name });
    setRenameOpen(false);
  }

  function deleteEntry() {
    if (!deleteConfirmed) return;
    void remove(entry.id)
      .then(() => {
        setPendingDelete(false);
        onClose();
      })
      .catch(() => {
        setPendingDelete(false);
        toast.error("Codex.deleteFailed");
      });
  }

  return (
    <div className="bg-neutral-50 dark:bg-neutral-700 flex h-full min-h-0 flex-col">
      <header className="bg-neutral-50 dark:bg-neutral-700 flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <span
          className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-md"
          style={{ color: colorOf(draft.typeId) }}
          title={typeLabel(type, t)}
        >
          <TypeGlyph icon={type?.icon} className="size-3.5" />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="min-w-0 truncate text-base font-semibold">
            {draft.name || "-"}
          </h2>
          <span
            role="status"
            aria-live="polite"
            aria-label={saveLabel}
            title={saveLabel}
            className={[
              "size-1.5 shrink-0 rounded-full transition-colors",
              saveState === "error"
                ? "bg-destructive"
                : saveState === "dirty"
                  ? "bg-amber-500"
                  : saveState === "saving"
                    ? "bg-sky-500 animate-pulse"
                    : "bg-emerald-500",
            ].join(" ")}
          />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <ScopePicker
            scope={draft.scope}
            onChange={(scope) => updateDraft({ ...draft, scope })}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs"
            onClick={openRenameDialog}
          >
            <Pencil className="size-3.5" />
            {t("Codex.rename")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs"
            onClick={() => {
              setDeleteConfirmName("");
              setPendingDelete(true);
            }}
          >
            <Trash2 className="size-3.5" />
            {t("Codex.delete")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onClose}
            aria-label={t("Codex.detail.close")}
            title={t("Codex.detail.close")}
          >
            <X className="size-4" />
          </Button>
        </div>
      </header>
      <div className="scrollbar-app min-h-0 flex-1 overflow-y-auto">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0">
            <Section title={t("Codex.overview")}>
              <div className="flex flex-col gap-2.5">
                <label className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs font-medium">
                    {t("Codex.summary")}
                  </span>
                  <Textarea
                    value={draft.summary}
                    rows={2}
                    placeholder={t("Codex.summaryPlaceholder")}
                    className="min-h-12 resize-none text-sm leading-relaxed"
                    onChange={(event) =>
                      updateDraft({ ...draft, summary: event.target.value })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs font-medium">
                    {t("Codex.body")}
                  </span>
                  <Textarea
                    value={draft.body}
                    rows={8}
                    placeholder={t("Codex.bodyPlaceholder")}
                    className="min-h-40 resize-y text-sm leading-relaxed"
                    onChange={(event) =>
                      updateDraft({ ...draft, body: event.target.value })
                    }
                  />
                </label>
              </div>
            </Section>

            {contentFields.length ? (
              <Section title={t("Codex.fields")}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {contentFields.map((field) => (
                    <div
                      key={field.key}
                      className={[
                        "min-w-0",
                        field.kind === "longtext" ? "sm:col-span-2" : "",
                      ].join(" ")}
                    >
                      <FieldItem
                        field={field}
                        value={draft.fields[field.key]}
                        onChange={(value) =>
                          updateDraft(patchField(draft, field.key, value))
                        }
                      />
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}
          </div>

          <div className="min-w-0 lg:border-l">
            {conflicts.length ? (
              <div className="m-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/8 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {t("Codex.aliasConflict")} {conflicts.join("、")}
                </span>
              </div>
            ) : null}
            <Section title={t("Codex.identity")}>
              <div className="grid grid-cols-1 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs font-medium">
                    {t("Codex.aliases")}
                  </span>
                  <Input
                    value={draft.aliases.join(", ")}
                    className="h-8 text-sm"
                    onChange={(event) =>
                      updateDraft({
                        ...draft,
                        aliases: parseList(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs font-medium">
                    {t("Codex.tags")}
                  </span>
                  <Input
                    value={draft.tags.join(", ")}
                    className="h-8 text-sm"
                    onChange={(event) =>
                      updateDraft({
                        ...draft,
                        tags: parseList(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
            </Section>

            {selectionFields.length ? (
              <Section title={t("Codex.selectionFields")}>
                <div className="flex flex-col gap-2">
                  {selectionFields.map((field) => (
                    <FieldItem
                      key={field.key}
                      field={field}
                      value={draft.fields[field.key]}
                      onChange={(value) =>
                        updateDraft(patchField(draft, field.key, value))
                      }
                    />
                  ))}
                </div>
              </Section>
            ) : null}

            <Section
              title={t("Codex.relations")}
              action={<RelationComposer entry={draft} />}
            >
              {linked.length ? (
                <div className="flex flex-col gap-1">
                  {linked.map(({ relation, kind, other, outgoing }) => (
                    <div
                      key={relation.id}
                      className="group hover:bg-accent/60 flex min-h-8 items-center gap-2 rounded-md px-1.5"
                    >
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: colorOf(other!.typeId) }}
                      />
                      <span className="text-muted-foreground w-14 shrink-0 truncate text-[11px]">
                        {kind}
                      </span>
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                        onClick={() => {
                          setCurrentEntryId(other!.id);
                        }}
                      >
                        {other!.name}
                      </button>
                      <span className="text-muted-foreground/50 text-[11px]">
                        {outgoing ? "→" : "←"}
                      </span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:bg-neutral-100 hover:text-destructive dark:hover:bg-neutral-800/50 flex size-6 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label={t("Codex.relation.remove")}
                        title={t("Codex.relation.remove")}
                        onClick={() => {
                          void removeRelation(relation.id).catch(() =>
                            toast.error("Codex.relation.removeFailed")
                          );
                        }}
                      >
                        <Unlink className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground/70 text-xs">
                  {t("Codex.relation.empty")}
                </p>
              )}
            </Section>

            <Section title={t("Codex.mentions.chapters")}>
              {mentionRecords.length ? (
                <div className="flex flex-col gap-1">
                  {mentionRecords.map((record) => {
                    const key = `${record.workId}:${record.chapterId}`;
                    const title = chapterTitles[key] || record.chapterId;
                    return (
                      <button
                        key={key}
                        type="button"
                        className="hover:bg-accent flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left"
                        onClick={() => jumpToMention(record)}
                      >
                        <BookOpen className="text-muted-foreground size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{title}</span>
                          <span className="text-muted-foreground/60 block truncate text-[11px]">
                            {works[record.workId]?.title ?? record.workId}
                          </span>
                        </span>
                        <span className="text-muted-foreground/60 text-[11px] tabular-nums">
                          {record.count}×
                        </span>
                        <ExternalLink className="text-muted-foreground size-3" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-muted-foreground/70 text-xs">
                  {t("Codex.mentions.empty")}
                </p>
              )}
            </Section>

          </div>
        </div>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveRename();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("Codex.renameTitle")}</DialogTitle>
              <DialogDescription>
                {t("Codex.renameDescription")}
              </DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t("Codex.name")}</span>
              <Input
                autoFocus
                autoComplete="off"
                value={renameDraft}
                placeholder={t("Codex.renamePlaceholder")}
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  if (event.nativeEvent.isComposing) {
                    event.preventDefault();
                    return;
                  }
                  event.preventDefault();
                  saveRename();
                }}
              />
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
              >
                {t("Editor.chapter.cancelRename")}
              </Button>
              <Button type="submit" disabled={!renameDraft.trim()}>
                {t("Codex.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete}
        onOpenChange={(open) => {
          setPendingDelete(open);
          if (!open) setDeleteConfirmName("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Codex.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed">
              {t("Codex.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t("Codex.deleteHint")}
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t("Codex.deleteConfirmHint").replace("{name}", draft.name)}
              </span>
              <Input
                autoFocus
                value={deleteConfirmName}
                placeholder={t("Codex.deleteConfirmPlaceholder")}
                onChange={(event) => setDeleteConfirmName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) {
                    return;
                  }
                  event.preventDefault();
                  deleteEntry();
                }}
              />
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("Editor.chapter.cancelRename")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={!deleteConfirmed}
              onClick={deleteEntry}
            >
              {t("Codex.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
