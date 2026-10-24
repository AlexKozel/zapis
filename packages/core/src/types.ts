/**
 * Общие типы. Одинаковы на телефоне (IndexedDB) и на сервере (PostgreSQL).
 * Время хранится как epoch-миллисекунды (UTC); перевод в местное время — на уровне UI.
 * Деньги — в минимальных единицах валюты (копейки/гроши), целыми числами.
 */

export type Id = string;

/** Поля, нужные для офлайн-синхронизации. */
export interface Syncable {
  id: Id;
  /** Время последнего изменения, epoch ms. При конфликте побеждает более позднее. */
  updatedAt: number;
  /** Мягкое удаление: запись не стирается, чтобы удаление тоже синхронизировалось. */
  deleted?: boolean;
}

export interface Service extends Syncable {
  name: string;
  /** Минимальная и максимальная длительность, минуты. Для стрижки обычно равны. */
  durationMinMin: number;
  durationMaxMin: number;
  /** Запас после услуги (уборка, подготовка), минуты. */
  bufferAfterMin: number;
  priceMin: number;
  priceMax: number;
  /** Консультация для новых клиентов — короткая отдельная услуга. */
  isConsultation?: boolean;
}

export type ReminderChannel = "telegram" | "instagram" | "viber" | "sms" | "whatsapp" | "none";

export interface Client extends Syncable {
  name: string;
  /** В международном виде, +375291234567. */
  phone?: string;
  /** Ник без @ (или телефон, если ника нет). */
  telegram?: string;
  /** Ник в Instagram без @. */
  instagram?: string;
  reminderChannel: ReminderChannel;
  /** Например, формула окрашивания. */
  notes?: string;
  /** Откуда пришёл: instagram, telegram, рекомендация... */
  source?: string;
}

export type AppointmentStatus = "scheduled" | "done" | "cancelled" | "no_show";

export interface Appointment extends Syncable {
  clientId: Id;
  serviceId: Id;
  start: number;
  end: number;
  /** Запас после записи, минуты (копируется из услуги при создании, можно изменить). */
  bufferAfterMin: number;
  /** Цена. Для будущей записи — ожидаемая, после визита — фактическая. */
  price: number;
  status: AppointmentStatus;
  /** Мастер сознательно поставил запись параллельно с другой. */
  parallel: boolean;
  note?: string;
}

/** Страна мастера: от неё зависит разбор телефонов без кода страны. */
export type Country = "BY" | "PL";

/** Рабочий интервал внутри дня в формате "HH:MM". */
export interface WorkRange {
  from: string;
  to: string;
}
