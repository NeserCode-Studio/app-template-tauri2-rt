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
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
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
    <form action={onItemSubmit} className="flex flex-col gap-1.5">
      {title ? <span className="text-sm font-medium">{title}</span> : null}
      {description ? (
        <span className="text-xs text-muted-foreground">{description}</span>
      ) : null}
      <div className="flex items-center gap-2">
        <Input
          type={type}
          placeholder={
            placeholder ?? t("Settings.items.input.default.placeholder")
          }
          autoComplete={autoComplete ? "on" : "off"}
          name="input"
          defaultValue={value}
          className="flex-1"
        />
        <Button type="submit" size="sm">
          {submit ?? t("Settings.items.input.default.submit")}
        </Button>
      </div>
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
    <form action={onItemSubmit} className="flex flex-col gap-1.5">
      {title ? <span className="text-sm font-medium">{title}</span> : null}
      {description ? (
        <span className="text-xs text-muted-foreground">{description}</span>
      ) : null}
      <div className="flex items-center gap-2">
        <Select
          name="select"
          onValueChange={onItemChange}
          defaultValue={value?.value}
        >
          <SelectTrigger className="flex-1">
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
        <Button type="submit" size="sm">
          {submit ?? t("Settings.items.select.default.submit")}
        </Button>
      </div>
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
    <div className="flex flex-col gap-1.5">
      {title ? <span className="text-sm font-medium">{title}</span> : null}
      {description ? (
        <span className="text-xs text-muted-foreground">{description}</span>
      ) : null}
      <div className="flex items-center gap-2">
        <Checkbox
          onCheckedChange={onItemChange}
          defaultChecked={value}
          id={id}
          name="optional"
        />
        <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
          {label}
        </Label>
      </div>
    </div>
  );
}
