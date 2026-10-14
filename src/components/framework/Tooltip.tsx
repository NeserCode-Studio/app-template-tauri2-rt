import { memo } from "react";
import {
  Tooltip as T,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TooltipProps } from "@/shared";

export const Tooltip = memo(function Tooltip({ content, children }: TooltipProps) {
  return (
    <T delayDuration={800}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        <p className="select-none">{content}</p>
      </TooltipContent>
    </T>
  );
});
