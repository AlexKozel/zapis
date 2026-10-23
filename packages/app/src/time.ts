import { MINUTE, parseHm } from "@zapis/core";

/**
 * Работа с местным временем устройства. День задаётся строкой "YYYY-MM-DD".
 *
 * «Опорная полночь» — местный полдень минус 12 часов. В обычный день это настоящая полночь,
 * а в день перевода часов (переход ночью) — момент, от которого "HH:MM" рабочего дня
 * отсчитываются правильно. Её и передаём в freeSlots как dayStart.
 */

export const HOUR = 60 * MINUTE;

export type DayKey = string;

export function dayKey(t: number): DayKey {
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function todayKey(): DayKey {
  return dayKey(Date.now());
}

function parts(key: DayKey): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y!, m! - 1, d!];
}

export function anchor(key: DayKey): number {
  const [y, m, d] = parts(key);
  return new Date(y, m, d, 12).getTime() - 12 * HOUR;
}

/** Настоящие границы местного дня [начало, конец). */
export function dayBounds(key: DayKey): { start: number; end: number } {
  const [y, m, d] = parts(key);
  return { start: new Date(y, m, d).getTime(), end: new Date(y, m, d + 1).getTime() };
}

export function addDays(key: DayKey, n: number): DayKey {
  const [y, m, d] = parts(key);
  return dayKey(new Date(y, m, d + n, 12).getTime());
}

/** Понедельник недели, в которую входит день. */
export function weekStart(key: DayKey): DayKey {
  return addDays(key, -(isoWeekday(key) - 1));
}

/** 1 — понедельник, 7 — воскресенье (как ключи workHours мастера). */
export function isoWeekday(key: DayKey): number {
  const [y, m, d] = parts(key);
  return ((new Date(y, m, d, 12).getDay() + 6) % 7) + 1;
}

/** "HH:MM" в выбранный день → epoch ms. */
export function atTime(key: DayKey, hm: string): number {
  return anchor(key) + parseHm(hm) * MINUTE;
}

/** Минуты от опорной полуночи — для раскладки по сетке дня. */
export function minutesInDay(key: DayKey, t: number): number {
  return Math.round((t - anchor(key)) / MINUTE);
}

/** Минуты от начала дня → "HH:MM". */
export function hm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

const timeFmt = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" });
const shortDayFmt = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short" });

export const fmtTime = (t: number) => timeFmt.format(t);
export const fmtDay = (key: DayKey) => dayFmt.format(anchor(key) + 12 * HOUR);
const weekdayFmt = new Intl.DateTimeFormat("ru-RU", { weekday: "short" });

export const fmtShortDay = (key: DayKey) => shortDayFmt.format(anchor(key) + 12 * HOUR);
export const fmtWeekday = (key: DayKey) => weekdayFmt.format(anchor(key) + 12 * HOUR);
export const dayOfMonth = (key: DayKey) => Number(key.slice(8));

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} мин`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

export function fmtMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100);
}
