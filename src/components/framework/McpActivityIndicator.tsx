import { useEffect, useState } from "react";
import { LoaderCircle, RadioTower } from "lucide-react";

import { useI18n } from "@/composables";
import { subscribeActivity, type McpActivity } from "@/mcp/activity";
import { subscribeApprovals } from "@/mcp/approval";
import { useMcpRuntime } from "@/mcp/runtime";
import McpStatusDialog from "./McpStatusDialog";

export default function McpActivityIndicator() {
  const { t } = useI18n();
  const runtime = useMcpRuntime();
  const [activities, setActivities] = useState<McpActivity[]>([]);
  const [approvalCount, setApprovalCount] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => subscribeActivity(setActivities), []);
  useEffect(
    () => subscribeApprovals((requests) => setApprovalCount(requests.length)),
    []
  );

  if (!activities.length && !approvalCount && runtime.phase !== "degraded") {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="bg-background/95 hover:bg-accent fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-md border px-3 py-2 text-xs shadow-lg backdrop-blur"
        onClick={() => setOpen(true)}
      >
        {activities.length || approvalCount ? (
          <LoaderCircle className="icon-sm animate-spin" />
        ) : (
          <RadioTower className="icon-sm text-amber-600" />
        )}
        <span>
          {approvalCount
            ? t("Mcp.activity.approval").replace(
                "{count}",
                String(approvalCount)
              )
            : activities.length
              ? t("Mcp.activity.running").replace(
                  "{count}",
                  String(activities.length)
                )
              : t("Mcp.status.degraded")}
        </span>
      </button>
      <McpStatusDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
