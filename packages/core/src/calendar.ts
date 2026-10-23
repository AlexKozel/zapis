import type { Appointment, WorkRange } from "./types.ts";

export const MINUTE = 60_000;

/** Записи, которые занимают время в календаре. */
export function isActive(a: Appointment): boolean {
  return !a.deleted && a.status !== "cancelled" && a.status !== "no_show";
}

/** Занятый интервал записи с учётом запаса после неё: [start, end + запас). */
export function occupied(a: Pick<Appointment, "start" | "end" | "bufferAfterMin">): {
  start: number;
  end: number;
} {
  return { start: a.start, end: a.end + a.bufferAfterMin * MINUTE };
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface BookingCandidate {
  id?: string;
  start: number;
  end: number;
  bufferAfterMin: number;
}

/** Активные записи, которые пересекаются с кандидатом (саму себя при редактировании не считаем). */
export function findConflicts(appointments: Appointment[], candidate: BookingCandidate): Appointment[] {
  const c = occupied(candidate);
  return appointments
    .filter((a) => isActive(a) && a.id !== candidate.id)
    .filter((a) => overlaps(occupied(a), c))
    .sort((x, y) => x.start - y.start);
}

export type BookingCheck =
  | { ok: true; parallel: boolean; conflicts: Appointment[] }
  | { ok: false; reason: "invalid_time" }
  | { ok: false; reason: "conflict"; conflicts: Appointment[] };

/**
 * Проверка перед сохранением записи.
 * Накладка блокирует сохранение, пока мастер явно не выберет «поставить параллельно».
 */
export function checkBooking(
  appointments: Appointment[],
  candidate: BookingCandidate,
  opts: { allowParallel?: boolean } = {},
): BookingCheck {
  if (!(candidate.end > candidate.start) || candidate.bufferAfterMin < 0) {
    return { ok: false, reason: "invalid_time" };
  }
  const conflicts = findConflicts(appointments, candidate);
  if (conflicts.length === 0) return { ok: true, parallel: false, conflicts };
  if (opts.allowParallel) return { ok: true, parallel: true, conflicts };
  return { ok: false, reason: "conflict", conflicts };
}

/** "HH:MM" → минуты от начала дня. */
export function parseHm(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) throw new Error(`Неверное время: ${hm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new Error(`Неверное время: ${hm}`);
  return h * 60 + min;
}

export interface FreeSlotsInput {
  /** Начало дня (местная полночь) в epoch ms — считает вызывающий код с учётом часового пояса. */
  dayStart: number;
  workRanges: WorkRange[];
  appointments: Appointment[];
  /** Длительность услуги, минуты. Для гибкой услуги передаём максимальную, чтобы не было накладок. */
  durationMin: number;
  bufferAfterMin: number;
  /** Шаг сетки, минуты. */
  stepMin?: number;
  /** Не предлагать окна раньше этого момента (например, «сейчас»). */
  notBefore?: number;
}

/** Возможные начала записи на день, в которые услуга помещается без накладок. */
export function freeSlots(input: FreeSlotsInput): number[] {
  const step = input.stepMin ?? 15;
  const result: number[] = [];
  const busy = input.appointments.filter(isActive).map(occupied);

  for (const range of input.workRanges) {
    const rangeStart = input.dayStart + parseHm(range.from) * MINUTE;
    const rangeEnd = input.dayStart + parseHm(range.to) * MINUTE;
    for (let t = rangeStart; t + input.durationMin * MINUTE <= rangeEnd; t += step * MINUTE) {
      if (input.notBefore !== undefined && t < input.notBefore) continue;
      const slot = { start: t, end: t + (input.durationMin + input.bufferAfterMin) * MINUTE };
      if (!busy.some((b) => overlaps(b, slot))) result.push(t);
    }
  }
  return result;
}

export interface FreeWindowsInput {
  /** Начало дня (местная полночь) в epoch ms, как в freeSlots. */
  dayStart: number;
  workRanges: WorkRange[];
  appointments: Appointment[];
  /** Окна короче этого не показываем, минуты. */
  minMin?: number;
  /** Обрезать окна, начавшиеся раньше этого момента (например, «сейчас»). */
  notBefore?: number;
}

/** Свободные промежутки рабочего времени дня (с учётом запаса после записей) — для подсветки в календаре. */
export function freeWindows(input: FreeWindowsInput): { start: number; end: number }[] {
  const minLen = (input.minMin ?? 0) * MINUTE;
  const busy = input.appointments
    .filter(isActive)
    .map(occupied)
    .sort((x, y) => x.start - y.start);
  const result: { start: number; end: number }[] = [];

  for (const range of input.workRanges) {
    const rangeEnd = input.dayStart + parseHm(range.to) * MINUTE;
    let cursor = Math.max(input.dayStart + parseHm(range.from) * MINUTE, input.notBefore ?? -Infinity);
    for (const b of busy) {
      if (b.end <= cursor) continue;
      if (b.start >= rangeEnd) break;
      if (b.start - cursor >= minLen && b.start > cursor) result.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
    }
    if (rangeEnd - cursor >= minLen && rangeEnd > cursor) result.push({ start: cursor, end: rangeEnd });
  }
  return result;
}

export interface Shift {
  appointment: Appointment;
  newStart: number;
  newEnd: number;
}

/**
 * Мастер задерживается с текущей записью на delayMin минут.
 * Возвращает следующие записи, которые придётся сдвинуть (по цепочке, пока задержка не «поглотится»
 * свободным временем). По этим данным готовится сообщение каждому клиенту «приходите к …».
 */
export function applyDelay(appointments: Appointment[], currentId: string, delayMin: number): Shift[] {
  const current = appointments.find((a) => a.id === currentId);
  if (!current || delayMin <= 0) return [];

  const following = appointments
    .filter((a) => isActive(a) && a.id !== currentId && !a.parallel && a.start >= current.start)
    .sort((x, y) => x.start - y.start);

  const shifts: Shift[] = [];
  let busyUntil = current.end + delayMin * MINUTE + current.bufferAfterMin * MINUTE;
  for (const a of following) {
    if (a.start >= busyUntil) break;
    const shift = busyUntil - a.start;
    const newStart = a.start + shift;
    const newEnd = a.end + shift;
    shifts.push({ appointment: a, newStart, newEnd });
    busyUntil = newEnd + a.bufferAfterMin * MINUTE;
  }
  return shifts;
}
