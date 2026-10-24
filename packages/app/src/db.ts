import Dexie, { type EntityTable, type Transaction } from "dexie";
import type { Appointment, Client, Country, Service, WorkRange } from "@zapis/core";
import type { UiLang } from "./i18n/index.ts";

/**
 * Локальная база телефона — главная копия данных мастера.
 * Каждое изменение пишется сюда и ставится в очередь outbox; сервер заберёт её на неделе 3.
 */

export interface Rows {
  services: Service;
  clients: Client;
  appointments: Appointment;
}
export type SyncTable = keyof Rows;

/** Очередь на отправку. Ключ "таблица:id" — повторные правки одной записи не плодят дубли. */
export interface OutboxEntry {
  key: string;
  table: SyncTable;
  id: string;
  updatedAt: number;
}

export interface Settings {
  key: "main";
  /** Рабочие интервалы по дням недели, "1" — понедельник. Как Master.workHours на сервере. */
  workHours: Record<string, WorkRange[]>;
  currency: string;
  lang: UiLang;
  country: Country;
  /** Когда мастер последний раз сохранял резервную копию (до синхронизации это единственная страховка). */
  lastBackupAt?: number;
}

class ZapisDb extends Dexie {
  services!: EntityTable<Service, "id">;
  clients!: EntityTable<Client, "id">;
  appointments!: EntityTable<Appointment, "id">;
  outbox!: EntityTable<OutboxEntry, "key">;
  settings!: EntityTable<Settings, "key">;

  constructor() {
    super("zapis");
    this.version(1).stores({
      services: "id, updatedAt",
      clients: "id, name, phone, updatedAt",
      appointments: "id, start, clientId, updatedAt",
      outbox: "key",
      settings: "key",
    });
    this.on("populate", (tx) => seed(tx));
  }
}

export const db = new ZapisDb();

export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID есть только в защищённом контексте; при открытии по http://192.168… в локальной сети — нет.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Сохранить запись локально и поставить в очередь на синхронизацию. */
export async function saveRow<K extends SyncTable>(
  table: K,
  row: Omit<Rows[K], "updatedAt"> & { updatedAt?: number },
): Promise<Rows[K]> {
  // updatedAt строго растёт, даже если часы телефона отстали от прошлой правки.
  const updatedAt = Math.max(Date.now(), (row.updatedAt ?? 0) + 1);
  const saved = { ...row, updatedAt } as Rows[K];
  await db.transaction("rw", db.table(table), db.outbox, async () => {
    await db.table(table).put(saved);
    await db.outbox.put({ key: `${table}:${saved.id}`, table, id: saved.id, updatedAt });
  });
  return saved;
}

/**
 * Записать готовые строки как есть (их updatedAt не меняется) — для импорта и восстановления из копии.
 * Тоже ставит их в очередь, чтобы при синхронизации они попали на сервер.
 */
export async function putRows<K extends SyncTable>(table: K, rows: Rows[K][]): Promise<void> {
  await db.transaction("rw", db.table(table), db.outbox, async () => {
    await db.table(table).bulkPut(rows);
    await db.outbox.bulkPut(rows.map((r) => ({ key: `${table}:${r.id}`, table, id: r.id, updatedAt: r.updatedAt })));
  });
}

export const DEFAULT_SETTINGS: Settings = {
  key: "main",
  workHours: Object.fromEntries(
    ["1", "2", "3", "4", "5", "6"].map((d) => [d, [{ from: "09:00", to: "19:00" }]]),
  ),
  currency: "BYN",
  lang: "ru",
  country: "BY",
};

/** Валюта страны: при смене страны в настройках меняется вместе с ней. Язык выбирается отдельно. */
export const CURRENCY: Record<Country, string> = { BY: "BYN", PL: "PLN" };

/** Стартовые услуги (цены в BYN — примерные), чтобы мастер мог сразу записывать. Редактирование — экран «Услуги» (неделя 2). */
function seed(tx: Transaction) {
  const now = Date.now();
  const s = (
    name: string,
    durationMinMin: number,
    durationMaxMin: number,
    bufferAfterMin: number,
    priceMin: number,
    priceMax: number,
    isConsultation = false,
  ): Service => ({
    id: uuid(),
    updatedAt: now,
    name,
    durationMinMin,
    durationMaxMin,
    bufferAfterMin,
    priceMin: priceMin * 100,
    priceMax: priceMax * 100,
    ...(isConsultation ? { isConsultation } : {}),
  });
  const services = [
    s("Женская стрижка", 60, 60, 15, 40, 60),
    s("Мужская стрижка", 45, 45, 10, 30, 30),
    s("Сложное окрашивание", 180, 300, 15, 200, 400),
    s("Тонирование", 90, 120, 15, 80, 120),
    s("Консультация", 20, 20, 0, 0, 0, true),
  ];
  tx.table("services").bulkAdd(services);
  tx.table("outbox").bulkAdd(
    services.map((x) => ({ key: `services:${x.id}`, table: "services", id: x.id, updatedAt: now })),
  );
  tx.table("settings").add(DEFAULT_SETTINGS);
}
