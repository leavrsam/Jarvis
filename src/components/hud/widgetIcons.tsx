// One icon per widget type (library, dock, minimised chips).
import React from 'react';
import {
  Activity,
  PieChart,
  CalendarDays,
  CalendarRange,
  Camera,
  Clock,
  CloudSun,
  Globe2,
  Hourglass,
  MessagesSquare,
  Music,
  Gauge,
  StickyNote,
  Sunrise,
  Wind,
  Zap,
  ShoppingCart,
  ListChecks,
  Lightbulb,
  Package,
  BellRing,
  Image,
  Newspaper,
  TrendingUp,
  Trophy,
  Car,
} from 'lucide-react';
import type { WidgetId } from '../../services/hudLayout';

const ICONS: Record<WidgetId, React.ComponentType<{ className?: string }>> = {
  clock: Clock,
  weather: CloudSun,
  calendar: CalendarDays,
  nowPlaying: Music,
  system: Gauge,
  conversation: MessagesSquare,
  camera: Camera,
  quickCommands: Zap,
  worldClocks: Globe2,
  airQuality: Wind,
  sunMoon: Sunrise,
  weekAhead: CalendarRange,
  countdown: Hourglass,
  notes: StickyNote,
  spectrum: Activity,
  shopping: ShoppingCart,
  tasks: ListChecks,
  smartHome: Lightbulb,
  deliveries: Package,
  doorbell: BellRing,
  photoFrame: Image,
  headlines: Newspaper,
  markets: TrendingUp,
  portfolio: PieChart,
  sports: Trophy,
  commute: Car,
};

export const WidgetIcon: React.FC<{ id: WidgetId; className?: string }> = ({ id, className }) => {
  const Icon = ICONS[id];
  return <Icon className={className} />;
};
