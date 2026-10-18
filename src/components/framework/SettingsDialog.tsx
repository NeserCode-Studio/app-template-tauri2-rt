import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/composables";
import { BookText, Settings2 } from "lucide-react";
import Settings from "@/views/Settings";
import WritingPrefs from "@/views/WritingPrefs";

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

        <Tabs defaultValue="writing" className="flex min-h-0 flex-1 flex-col">
          <div className="border-b px-6 pt-3">
            <TabsList className="justify-start gap-1 rounded-lg bg-muted/50 p-1">
              <TabsTrigger value="writing" className="gap-1.5">
                <BookText className="icon-md" />
                {t("Prefs.tab.writing")}
              </TabsTrigger>
              <TabsTrigger value="general" className="gap-1.5">
                <Settings2 className="icon-md" />
                {t("Settings.tabs.general")}
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="px-6 py-5">
              <TabsContent value="writing">
                <WritingPrefs />
              </TabsContent>
              <TabsContent value="general">
                <Settings />
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
