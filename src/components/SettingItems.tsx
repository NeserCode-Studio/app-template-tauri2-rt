import { useI18n } from "@/composables";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import type {
  SettingInputItemProps,
  SettingSelectItemProps,
  SettingOptionalItemProps,
  SettingItemGroup,
} from "@/shared";

export function SettingItemGroup({
  title,
  description,
  children,
}: SettingItemGroup) {
  return (
    <div className="setting-item-group">
      <span className="group-info">
        <span className="title">{title}</span>
        <span className="description">{description}</span>
      </span>
      <div className="group-main">{children}</div>
    </div>
  );
}

export function SettingInputItem({
  type,
  placeholder,
  onItemSubmit,
  submit,
  value,
  title,
  description,
  autoComplete = true,
}: SettingInputItemProps & { autoComplete?: boolean }) {
  const { t } = useI18n();

  return (
    <form action={onItemSubmit} className="setting-input-item setting-item">
      {title ? <span className="title">{title}</span> : null}
      {description ? <span className="description">{description}</span> : null}
      <span className="main">
        <Input
          type={type}
          placeholder={
            placeholder ?? t("Settings.items.input.default.placeholder")
          }
          autoComplete={autoComplete ? "on" : "off"}
          name="input"
          defaultValue={value}
          className="main"
        />
        <Button type="submit">
          {submit ?? t("Settings.items.input.default.submit")}
        </Button>
      </span>
    </form>
  );
}

export function SettingSelectItem({
  placeholder,
  onItemSubmit,
  onItemChange,
  submit,
  label,
  items,
  value,
  title,
  description,
}: SettingSelectItemProps) {
  const { t } = useI18n();

  return (
    <form action={onItemSubmit} className="setting-select-item setting-item">
      {title ? <span className="title">{title}</span> : null}
      {description ? <span className="description">{description}</span> : null}
      <span className="main">
        <Select
          name="select"
          onValueChange={onItemChange}
          defaultValue={value?.value}
        >
          <SelectTrigger className="trigger">
            <SelectValue
              placeholder={
                placeholder ?? t("Settings.items.select.default.placeholder")
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>
                {label ?? t("Settings.items.select.default.label")}
              </SelectLabel>
              {items?.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button type="submit">
          {submit ?? t("Settings.items.select.default.submit")}
        </Button>
      </span>
    </form>
  );
}

export function SettingOptionalItem({
  onItemChange,
  id,
  label,
  value,
  title,
  description,
}: SettingOptionalItemProps) {
  return (
    <form className="setting-optional-item setting-item">
      {title ? <span className="title">{title}</span> : null}
      {description ? <span className="description">{description}</span> : null}
      <span className="main">
        <Checkbox
          onCheckedChange={onItemChange}
          defaultChecked={value}
          id={id}
          name="optional"
        />
        <Label htmlFor={id}>{label}</Label>
      </span>
    </form>
  );
}
