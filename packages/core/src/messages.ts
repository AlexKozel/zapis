/**
 * Тексты сообщений клиентам. Отправка через Telegram-бота автоматическая,
 * для Viber и SMS мастер отправляет готовый текст одной кнопкой (deep link).
 */

export type Lang = "ru" | "uk" | "pl" | "en";

function hm(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone }).format(ms);
}

function dayMonth(ms: number, timeZone: string, lang: Lang): string {
  const locale = { ru: "ru-RU", uk: "uk-UA", pl: "pl-PL", en: "en-GB" }[lang];
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone }).format(ms);
}

export function reminderText(p: {
  lang: Lang;
  clientName: string;
  masterName: string;
  start: number;
  timeZone: string;
}): string {
  const t = hm(p.start, p.timeZone);
  const d = dayMonth(p.start, p.timeZone, p.lang);
  switch (p.lang) {
    case "uk":
      return `${p.clientName}, нагадую про запис до ${p.masterName} завтра, ${d}, о ${t}. Якщо плани змінились, напишіть, будь ласка.`;
    case "pl":
      return `${p.clientName}, przypominam o wizycie u ${p.masterName} jutro, ${d}, o ${t}. Jeśli plany się zmieniły, proszę o wiadomość.`;
    case "en":
      return `Hi ${p.clientName}, a reminder of your appointment with ${p.masterName} tomorrow, ${d}, at ${t}. If your plans change, please let me know.`;
    default:
      return `${p.clientName}, напоминаю о записи к ${p.masterName} завтра, ${d}, в ${t}. Если планы изменились, напишите, пожалуйста.`;
  }
}

export function delayText(p: { lang: Lang; clientName: string; newStart: number; timeZone: string }): string {
  const t = hm(p.newStart, p.timeZone);
  switch (p.lang) {
    case "uk":
      return `${p.clientName}, я трохи затримуюсь з попередньою клієнткою. Можете прийти о ${t}? Дякую за розуміння!`;
    case "pl":
      return `${p.clientName}, trochę się przedłuża poprzednia wizyta. Czy możesz przyjść o ${t}? Dziękuję za wyrozumiałość!`;
    case "en":
      return `Hi ${p.clientName}, I'm running a little late with the previous client. Could you come at ${t}? Thank you!`;
    default:
      return `${p.clientName}, немного задерживаюсь с предыдущей клиенткой. Сможете подойти к ${t}? Спасибо за понимание!`;
  }
}

/** Ссылка, которая открывает Viber или SMS с готовым текстом. */
export function shareLink(channel: "viber" | "sms", phone: string, text: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (channel === "viber") {
    // Viber открывает чат по номеру; текст мастер вставляет из буфера обмена.
    return `viber://chat?number=${encodeURIComponent(digits)}`;
  }
  return `sms:${digits}?body=${encodeURIComponent(text)}`;
}
