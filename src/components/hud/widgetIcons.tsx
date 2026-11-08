// One icon per widget type (library, dock, minimised chips).
import React from 'react';
import {
  Activity,
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
};

export const WidgetIcon: React.FC<{ id: WidgetId; className?: string }> = ({ id, className }) => {
  const Icon = ICONS[id];
  return <Icon className={className} />;
};
