import { MINUTE, parseHm } from "@zapis/core";
import { locale, t } from "./i18n/index.ts";

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

/** Первое число месяца. */
export function monthStart(key: DayKey): DayKey {
  return key.slice(0, 8) + "01";
}

/** Первое число месяца, отстоящего на n месяцев. */
export function addMonths(key: DayKey, n: number): DayKey {
  const [y, m] = parts(key);
  return dayKey(new Date(y, m + n, 1, 12).getTime());
}

/** Сколько дней от a до b (b позже — положительное). */
export function dayDiff(a: DayKey, b: DayKey): number {
  return Math.round((anchor(b) - anchor(a)) / (24 * HOUR));
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
export function minutesInDay(key: DayKey, ms: number): number {
  return Math.round((ms - anchor(key)) / MINUTE);
}

/** Минуты от начала дня → "HH:MM". */
export function hm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// Форматы зависят от языка интерфейса; Intl-объекты дорогие, поэтому кешируем по локали.
const formatters = new Map<string, Intl.DateTimeFormat>();
function dateFmt(name: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${name}`;
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = new Intl.DateTimeFormat(locale, opts)));
  return f;
}
const noon = (key: DayKey) => anchor(key) + 12 * HOUR;

export const fmtTime = (ms: number) => dateFmt("time", { hour: "2-digit", minute: "2-digit" }).format(ms);
export const fmtDay = (key: DayKey) => dateFmt("day", { weekday: "long", day: "numeric", month: "long" }).format(noon(key));
export const fmtShortDay = (key: DayKey) =>
  dateFmt("shortDay", { weekday: "short", day: "numeric", month: "short" }).format(noon(key));
/** Дата визита: год — только если он не текущий. */
export const fmtDate = (ms: number) =>
  new Date(ms).getFullYear() === new Date().getFullYear()
    ? dateFmt("date", { day: "numeric", month: "short" }).format(ms)
    : dateFmt("dateYear", { day: "numeric", month: "short", year: "numeric" }).format(ms);
export const fmtWeekday = (key: DayKey) => dateFmt("weekday", { weekday: "short" }).format(noon(key));
export const fmtWeekdayLong = (key: DayKey) => dateFmt("weekdayLong", { weekday: "long" }).format(noon(key));
export const dayOfMonth = (key: DayKey) => Number(key.slice(8));
export const fmtMonth = (key: DayKey) => dateFmt("month", { month: "long", year: "numeric" }).format(noon(key));

/** Коротко для ячейки месяца: 285 мин → «4,5 ч» (вниз до получаса, чтобы не обещать лишнего). */
export function fmtHours(min: number): string {
  const hours = Math.floor(min / 30) / 2;
  return t.hoursShort(new Intl.NumberFormat(locale).format(hours));
}

export function fmtDuration(min: number): string {
  return t.duration(Math.floor(min / 60), min % 60);
}

export function fmtMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100);
}
