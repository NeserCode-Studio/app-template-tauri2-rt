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

export const TYPE_ICON_OPTIONS = Object.keys(ICONS);

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
