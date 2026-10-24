import { ru, type Dict } from "./ru.ts";
import { pl } from "./pl.ts";

/**
 * Язык интерфейса задаётся в настройках. App вызывает setLang до отрисовки экранов и перемонтирует их
 * при смене языка, поэтому компоненты просто читают `t` и `locale`.
 */
export type UiLang = "ru" | "pl";

export const LANGS: Record<UiLang, { dict: Dict; locale: string; name: string }> = {
  ru: { dict: ru, locale: "ru-RU", name: "Русский" },
  pl: { dict: pl, locale: "pl-PL", name: "Polski" },
};

export let t: Dict = ru;
export let locale = LANGS.ru.locale;

export function setLang(lang: UiLang) {
  t = LANGS[lang].dict;
  locale = LANGS[lang].locale;
}
