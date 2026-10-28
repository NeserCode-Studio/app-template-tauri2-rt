import {
  BookOpen,
  CalendarClock,
  Clock3,
  Flag,
  Landmark,
  Layers3,
  MapPin,
  Package,
  Shapes,
  UserRound,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  user: UserRound,
  "map-pin": MapPin,
  package: Package,
  flag: Flag,
  clock: Clock3,
  layers: Layers3,
  landmark: Landmark,
  "book-open": BookOpen,
  "calendar-clock": CalendarClock,
  shapes: Shapes,
};

export interface TypeIconOption {
  value: string;
  labelKey: string;
}

export const TYPE_ICON_OPTIONS: TypeIconOption[] = [
  { value: "user", labelKey: "Codex.icon.user" },
  { value: "map-pin", labelKey: "Codex.icon.mapPin" },
  { value: "package", labelKey: "Codex.icon.package" },
  { value: "flag", labelKey: "Codex.icon.flag" },
  { value: "clock", labelKey: "Codex.icon.clock" },
  { value: "layers", labelKey: "Codex.icon.layers" },
  { value: "landmark", labelKey: "Codex.icon.landmark" },
  { value: "book-open", labelKey: "Codex.icon.bookOpen" },
  { value: "calendar-clock", labelKey: "Codex.icon.calendarClock" },
  { value: "shapes", labelKey: "Codex.icon.shapes" },
];

export function TypeGlyph({
  icon,
  className,
}: {
  icon?: string;
  className?: string;
}) {
  const Icon = ICONS[icon ?? "shapes"] ?? Shapes;
  return <Icon className={className} aria-hidden="true" />;
}
