import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/composables";
import { Settings2 } from "lucide-react";
import Settings from "@/views/Settings";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsDialog({
  open,
  onOpenChange,
}: SettingsDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <header className="flex items-center gap-3 border-b bg-muted/40 px-6 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Settings2 className="size-5" />
          </span>
          <div className="stack-1">
            <DialogTitle className="text-base leading-tight font-semibold">
              {t("Titlebar.menu.turnto.settings")}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t("Settings.search.description")}
            </DialogDescription>
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-6 py-5">
            <Settings />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
