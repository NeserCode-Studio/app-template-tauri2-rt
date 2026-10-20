import { HexColorPicker } from "react-colorful";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface ColorSwatchPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * 应用内颜色选择器。
 *
 * 原生 input[type=color] 会打开不可控的系统级取色面板，尺寸、主题和
 * 关闭行为都脱离应用。这里保留一个 32px 的真实颜色方块作为触发器，
 * 取色面板则复用 Popover 的定位、焦点和关闭逻辑。
 */
export function ColorSwatchPicker({
  label,
  value,
  onChange,
}: ColorSwatchPickerProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={`${label}: ${value.toUpperCase()}`}
          className="border-border/70 focus-visible:ring-ring size-8 shrink-0 rounded-md border shadow-sm outline-none focus-visible:ring-2"
          style={{ backgroundColor: value }}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-medium">{label}</span>
          <code className="text-muted-foreground text-[11px]">
            {value.toUpperCase()}
          </code>
        </div>
        <HexColorPicker
          color={value}
          onChange={onChange}
          style={{ width: "100%", height: 144 }}
        />
      </PopoverContent>
    </Popover>
  );
}
