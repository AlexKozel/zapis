import type { Appointment } from "./types.ts";

const DAY = 86_400_000;

export interface ClientStats {
  visits: number;
  total: number;
  lastVisit?: number;
  nextVisit?: number;
  /** Средний интервал между визитами, дней (нужно минимум 2 визита). */
  avgIntervalDays?: number;
}

/** Статистика по клиенту: считается из записей, отдельно не хранится. */
export function clientStats(appointments: Appointment[], clientId: string, now: number): ClientStats {
  const mine = appointments.filter((a) => !a.deleted && a.clientId === clientId);
  const done = mine.filter((a) => a.status === "done").sort((x, y) => x.start - y.start);
  const upcoming = mine
    .filter((a) => a.status === "scheduled" && a.start >= now)
    .sort((x, y) => x.start - y.start);

  const stats: ClientStats = {
    visits: done.length,
    total: done.reduce((s, a) => s + a.price, 0),
    lastVisit: done.at(-1)?.start,
    nextVisit: upcoming[0]?.start,
  };
  if (done.length >= 2) {
    const first = done[0]!.start;
    const last = done.at(-1)!.start;
    stats.avgIntervalDays = Math.round((last - first) / DAY / (done.length - 1));
  }
  return stats;
}

export interface IncomeSummary {
  visits: number;
  income: number;
  noShows: number;
  cancelled: number;
}

/** Итоги за период [from, to): доход считаем только по состоявшимся визитам. */
export function incomeSummary(appointments: Appointment[], from: number, to: number): IncomeSummary {
  const inRange = appointments.filter((a) => !a.deleted && a.start >= from && a.start < to);
  const done = inRange.filter((a) => a.status === "done");
  return {
    visits: done.length,
    income: done.reduce((s, a) => s + a.price, 0),
    noShows: inRange.filter((a) => a.status === "no_show").length,
    cancelled: inRange.filter((a) => a.status === "cancelled").length,
  };
}
