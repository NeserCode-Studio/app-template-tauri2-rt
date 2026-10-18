import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/composables";
import type { OutlineNode } from "@/shared/schema";

export type NodeStatus = "draft" | "revising" | "final";

export interface NodeMetaEditorProps {
  node: OutlineNode;
  status: NodeStatus;
  synopsis: string;
  onChange: (patch: { status?: NodeStatus; synopsis?: string }) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export default function NodeMetaEditor({
  node,
  status,
  synopsis,
  onChange,
  onSubmit,
  onCancel,
}: NodeMetaEditorProps) {
  const { t } = useI18n();
  void node;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-background p-1.5">
      <Select value={status} onValueChange={(v) => onChange({ status: v as NodeStatus })}>
        <SelectTrigger className="h-7 text-xs" aria-label={t("Editor.node.status")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="draft">{t("Editor.node.status.draft")}</SelectItem>
          <SelectItem value="revising">{t("Editor.node.status.revising")}</SelectItem>
          <SelectItem value="final">{t("Editor.node.status.final")}</SelectItem>
        </SelectContent>
      </Select>

      <Input
        autoFocus
        value={synopsis}
        placeholder={t("Editor.node.synopsis")}
        aria-label={t("Editor.node.synopsis")}
        className="h-7 text-xs"
        onChange={(e) => onChange({ synopsis: e.target.value })}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape") onCancel();
        }}
      />

      <div className="flex gap-1">
        <Button size="sm" className="h-6 flex-1 text-xs" onClick={onSubmit}>
          {t("Editor.chapter.confirmRename")}
        </Button>
        <Button size="sm" variant="ghost" className="h-6 flex-1 text-xs" onClick={onCancel}>
          {t("Editor.chapter.cancelRename")}
        </Button>
      </div>
    </div>
  );
}
