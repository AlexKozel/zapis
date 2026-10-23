import type { Syncable } from "./types.ts";

/**
 * Слияние двух копий данных (телефон и сервер) по правилу «побеждает последнее изменение».
 * Проигравшие версии возвращаются отдельно, чтобы сохранить их в истории — ничего не теряется.
 */
export function mergeById<T extends Syncable>(
  local: T[],
  remote: T[],
): { merged: T[]; overwritten: T[] } {
  const byId = new Map<string, T>();
  const overwritten: T[] = [];

  for (const item of local) byId.set(item.id, item);
  for (const item of remote) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
    } else if (item.updatedAt > existing.updatedAt) {
      overwritten.push(existing);
      byId.set(item.id, item);
    } else if (item.updatedAt < existing.updatedAt) {
      overwritten.push(item);
    }
    // Одинаковое время — это та же версия, ничего не делаем.
  }
  return { merged: [...byId.values()], overwritten };
}
