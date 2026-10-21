import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";

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
import { useI18n } from "@/composables";
import {
  pendingApprovals,
  resolveApproval,
  subscribeApprovals,
  type ApprovalRequest,
} from "@/mcp/approval";

export default function McpApprovalDialog() {
  const { t } = useI18n();
  const [requests, setRequests] =
    useState<ApprovalRequest[]>(pendingApprovals());
  const current = requests[0] ?? null;

  useEffect(() => subscribeApprovals(setRequests), []);

  return (
    <AlertDialog
      open={current !== null}
      onOpenChange={(open) => {
        if (!open && current) resolveApproval(current.id, false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="icon-md text-amber-600" />
            {t("Mcp.approval.title")}
          </AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-3">
            <span>{t("Mcp.approval.description")}</span>
            <span className="text-foreground font-medium">
              {current?.title}
            </span>
            <span className="bg-muted/35 text-foreground rounded-md border p-3 font-mono text-xs leading-relaxed">
              {current?.target}
              <br />
              {current?.summary}
            </span>
            <span>
              {t("Mcp.approval.risk")}: {current?.risk}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => current && resolveApproval(current.id, false)}
          >
            {t("Mcp.approval.deny")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => current && resolveApproval(current.id, true)}
          >
            {t("Mcp.approval.approve")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
