import type { Client, Country } from "./types.ts";

/**
 * Импорт клиентов: CSV (выгрузка из другой программы или Excel) и vCard (контакты iPhone).
 * Разбор не зависит от браузера, поэтому живёт в ядре и покрыт тестами.
 */

export interface ClientDraft {
  name: string;
  phone?: string;
  telegram?: string;
  instagram?: string;
  notes?: string;
  source?: string;
}

const DIAL: Record<Country, string> = { BY: "375", PL: "48" };

/**
 * Телефон в международном виде (+375291234567). Понимает местные записи: «8 029 123-45-67», «29 1234567»
 * для Беларуси и «600 123 456» для Польши. Если формат не распознан — undefined.
 */
export function normalizePhone(raw: string, country: Country): string | undefined {
  const plus = raw.trim().startsWith("+");
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (!plus) {
    const code = DIAL[country];
    if (country === "BY" && d.length === 11 && d.startsWith("80")) d = code + d.slice(2);
    else if (d.length === 9) d = code + d;
  }
  return d.length >= 10 && d.length <= 15 ? `+${d}` : undefined;
}

/** Ник из «@nick», «t.me/nick» или «instagram.com/nick/». */
export function normalizeHandle(raw: string): string | undefined {
  const h = raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?(t\.me|telegram\.me|instagram\.com)\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  return h || undefined;
}

/** CSV → строки таблицы. Разделитель (; , или табуляция) определяется по первой строке. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", ",", "\t"].reduce((best, c) => (count(firstLine, c) > count(firstLine, best) ? c : best), ";");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

type Column = keyof ClientDraft | "lastName";

const HEADERS: [Column, RegExp][] = [
  ["lastName", /^(фамилия|nazwisko|surname|last ?name)$/i],
  ["telegram", /telegram|телеграм/i],
  ["instagram", /instagram|инстаграм|insta/i],
  ["phone", /тел|phone|номер|mobile|komórk|komork/i],
  ["notes", /замет|коммент|примеч|note|uwagi|komentarz|opis/i],
  ["source", /источник|откуда|source|źródło|zrodlo/i],
  ["name", /имя|фио|клиент|name|imi[ęe]|klient/i],
];

/** Строки таблицы → черновики клиентов. Колонки узнаются по заголовкам на русском, польском и английском. */
export function clientsFromTable(rows: string[][], country: Country): { drafts: ClientDraft[]; skipped: number } {
  const header = rows[0] ?? [];
  const columns = header.map((h) => HEADERS.find(([, re]) => re.test(h))?.[0]);
  const hasHeader = columns.includes("name") || columns.includes("phone");
  // Без заголовка считаем, что первая колонка — имя, вторая — телефон.
  const cols: (Column | undefined)[] = hasHeader ? columns : ["name", "phone"];
  const body = hasHeader ? rows.slice(1) : rows;

  const drafts: ClientDraft[] = [];
  let skipped = 0;
  for (const r of body) {
    const get = (c: Column) =>
      cols
        .map((col, i) => (col === c ? r[i] : undefined))
        .filter((v): v is string => !!v)
        .join(" ")
        .trim();
    const rawPhone = get("phone");
    const phone = rawPhone ? (normalizePhone(rawPhone, country) ?? rawPhone) : undefined;
    const name = [get("name"), get("lastName")].filter(Boolean).join(" ") || phone;
    if (!name) {
      skipped++;
      continue;
    }
    drafts.push(compact({
      name,
      phone,
      telegram: normalizeHandle(get("telegram")),
      instagram: normalizeHandle(get("instagram")),
      notes: get("notes") || undefined,
      source: get("source") || undefined,
    }));
  }
  return { drafts, skipped };
}

/** vCard (.vcf) → черновики. iPhone выгружает так выбранные контакты или всю книгу через iCloud. */
export function clientsFromVcf(text: string, country: Country): ClientDraft[] {
  // Длинные строки vCard переносятся с пробелом в начале следующей.
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const drafts: ClientDraft[] = [];
  let card: { fn?: string; n?: string; tel?: string; note?: string } | null = null;

  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    // "item1.TEL;type=CELL" → "TEL"
    const key = line.slice(0, colon).split(";")[0]!.replace(/^[^.]+\./, "").toUpperCase();
    const value = unescapeVcf(line.slice(colon + 1));
    if (key === "BEGIN" && value.toUpperCase() === "VCARD") card = {};
    else if (!card) continue;
    else if (key === "FN") card.fn = value;
    else if (key === "N") card.n = value.split(";").slice(0, 2).reverse().join(" ").trim();
    else if (key === "TEL" && !card.tel) card.tel = value;
    else if (key === "NOTE") card.note = value;
    else if (key === "END") {
      const phone = card.tel ? (normalizePhone(card.tel, country) ?? card.tel) : undefined;
      const name = card.fn?.trim() || card.n || phone;
      if (name) drafts.push(compact({ name, phone, notes: card.note }));
      card = null;
    }
  }
  return drafts;
}

/**
 * Клиент → vCard 3.0 для телефонной книги. Сайт не может сам записать контакт в телефон,
 * поэтому приложение отдаёт этот файл системе, а та предлагает «Создать новый контакт».
 */
export function clientToVcf(c: Pick<ClientDraft, "name" | "phone" | "telegram" | "instagram" | "notes">): string {
  const [first = "", ...rest] = c.name.trim().split(/\s+/);
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${escapeVcf(rest.join(" "))};${escapeVcf(first)};;;`, `FN:${escapeVcf(c.name.trim())}`];
  if (c.phone) lines.push(`TEL;TYPE=CELL:${c.phone}`);
  if (c.instagram) lines.push(`X-SOCIALPROFILE;type=instagram:https://instagram.com/${c.instagram}`);
  if (c.telegram) lines.push(`X-SOCIALPROFILE;type=telegram:https://t.me/${c.telegram}`);
  if (c.notes) lines.push(`NOTE:${escapeVcf(c.notes)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

function escapeVcf(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

function unescapeVcf(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();
}

function compact(d: ClientDraft): ClientDraft {
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined && v !== "")) as unknown as ClientDraft;
}

/**
 * Убирает тех, кто уже есть в базе или повторяется в файле: по телефону, а без телефона — по имени.
 * Повторный импорт того же файла ничего не задвоит.
 */
export function dedupeClients(drafts: ClientDraft[], existing: Pick<Client, "name" | "phone" | "deleted">[]): {
  fresh: ClientDraft[];
  duplicates: number;
} {
  const key = (c: { name: string; phone?: string }) =>
    c.phone ? "tel:" + c.phone.replace(/\D/g, "") : "name:" + c.name.trim().toLowerCase();
  const seen = new Set(existing.filter((c) => !c.deleted).map(key));
  const fresh: ClientDraft[] = [];
  for (const d of drafts) {
    const k = key(d);
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(d);
  }
  return { fresh, duplicates: drafts.length - fresh.length };
}
