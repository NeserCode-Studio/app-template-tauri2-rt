import type { TypeConfig } from "./types";

/**
 * 类型显示名的唯一口径。
 *
 * 内置类型默认留空 label 并走 i18n；用户一旦填写自由 label，
 * 就以用户文本优先。自定义类型没有 labelKey，直接显示 label。
 */
export function typeLabel(
  type: TypeConfig | null | undefined,
  translate: (key: string) => string
): string {
  if (!type) return "";
  const custom = type.label.trim();
  if (custom) return custom;
  return type.labelKey ? translate(type.labelKey) : type.id;
}

export function typeLabelById(
  types: TypeConfig[],
  typeId: string,
  translate: (key: string) => string
): string {
  return (
    typeLabel(
      types.find((type) => type.id === typeId),
      translate
    ) || typeId
  );
}
