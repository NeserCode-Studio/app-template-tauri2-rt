import { Dialog, DialogContent } from "@/components/ui/dialog";

import { ScrollArea } from "@/components/ui/scroll-area";
import Settings from "@/views/Settings";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsDialog({
  open,
  onOpenChange,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg h-[75vh] flex flex-col">
        <ScrollArea className="min-h-0 flex-1">
          <Settings />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
