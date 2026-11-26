import { c, mix } from '../../theme/tokens';
import type { CalendarInfo, Occurrence } from './model';

export const tint = (color: string, amount = 26) => `color-mix(in srgb, ${color} ${amount}%, ${c.surfaceContainerLowest})`;

export const strongTint = (color: string) => `color-mix(in srgb, ${color} 42%, ${c.surfaceContainerLowest})`;

export const HOLIDAY_COLOR = '#10b981';
export const OBSERVANCE_COLOR = '#64748b';
export const BIRTHDAY_COLOR = '#ec4899';

function hash(text: string) {
  let value = 0;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value;
}

const CATEGORY_COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f97316', '#ec4899', '#06b6d4', '#eab308', '#ef4444', '#14b8a6', '#a855f7'];

export const categoryColor = (name: string) => CATEGORY_COLORS[hash(name.toLowerCase()) % CATEGORY_COLORS.length];

export function colorOf(item: Occurrence, calendar: CalendarInfo | undefined, by: 'calendar' | 'category' = 'calendar') {
  if (item.holiday) return item.holiday === 'observance' ? OBSERVANCE_COLOR : HOLIDAY_COLOR;
  if (item.color) return item.color;
  if (by === 'category' && item.categories.length) return categoryColor(item.categories[0]);
  return calendar?.color ?? '#8b5cf6';
}

export const busyStripes = (color: string) => `repeating-linear-gradient(135deg, ${mix(color, 18)} 0 6px, ${mix(color, 8)} 6px 12px)`;

export function readableOn(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? '#1d1b20' : '#ffffff';
}
