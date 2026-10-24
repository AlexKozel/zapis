import { useLiveQuery } from "dexie-react-hooks";
import type { Appointment, Client, Service, WorkRange } from "@zapis/core";
import { db, DEFAULT_SETTINGS, type Settings } from "./db.ts";
import { addDays, dayBounds, isoWeekday, type DayKey } from "./time.ts";

/** Хуки чтения из локальной базы. useLiveQuery перерисовывает экран при любом изменении данных. */

export function useSettings(): Settings {
  const stored = useLiveQuery(() => db.settings.get("main"), []);
  // Поля, добавленные в новых версиях, берём из значений по умолчанию.
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(patch: Partial<Omit<Settings, "key">>) {
  const current = await db.settings.get("main");
  await db.settings.put({ ...DEFAULT_SETTINGS, ...current, ...patch });
}

export function workRangesFor(settings: Settings, date: DayKey): WorkRange[] {
  return settings.workHours[String(isoWeekday(date))] ?? [];
}

export function useServices(): Service[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.services.toArray();
    return all
      .filter((s) => !s.deleted)
      .sort((a, b) => Number(!!a.isConsultation) - Number(!!b.isConsultation) || a.name.localeCompare(b.name, "ru"));
  }, []);
}

export function byId<T extends { id: string }>(rows: T[] | undefined): Map<string, T> {
  return new Map((rows ?? []).map((r) => [r.id, r]));
}

export function useClients(): Client[] | undefined {
  return useLiveQuery(() => db.clients.filter((c) => !c.deleted).toArray(), []);
}

/** Записи, которые пересекаются с днями [from, from + days), включая отменённые; удалённые — нет. */
export function appointmentsInDays(from: DayKey, days: number): Promise<Appointment[]> {
  const start = dayBounds(from).start;
  const end = dayBounds(addDays(from, days - 1)).end;
  // Запись могла начаться накануне вечером и перейти через полночь.
  return db.appointments
    .where("start")
    .between(start - 24 * 3_600_000, end, true, false)
    .filter((a) => !a.deleted && a.end > start)
    .sortBy("start");
}

/** Все записи клиента, новые сверху. */
export function useClientAppointments(clientId: string): Appointment[] | undefined {
  return useLiveQuery(
    async () =>
      (await db.appointments.where("clientId").equals(clientId).filter((a) => !a.deleted).sortBy("start")).reverse(),
    [clientId],
  );
}

export function useAppointments(from: DayKey, days = 1): Appointment[] | undefined {
  return useLiveQuery(() => appointmentsInDays(from, days), [from, days]);
}
