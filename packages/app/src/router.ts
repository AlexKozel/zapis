import { useEffect, useState } from "react";
import { todayKey, type DayKey } from "./time.ts";

/**
 * Маршруты в hash, чтобы кнопка «назад» на телефоне работала и офлайн-PWA не нуждалась в настройке сервера.
 *   #/day/2026-10-26?saved=<id>   #/week/2026-10-26   #/new?date=2026-10-26&time=10:30   #/edit/<id>
 */
export type Route =
  | { screen: "day"; date: DayKey; saved?: string }
  | { screen: "week"; date: DayKey }
  | { screen: "new"; date: DayKey; time?: string }
  | { screen: "edit"; id: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const q = new URLSearchParams(query);
  const [screen, arg = ""] = path.split("/");
  const date = DATE.test(arg) ? arg : (q.get("date") ?? todayKey());
  switch (screen) {
    case "week":
      return { screen: "week", date };
    case "new":
      return { screen: "new", date: DATE.test(date) ? date : todayKey(), time: q.get("time") ?? undefined };
    case "edit":
      if (arg) return { screen: "edit", id: arg };
      break;
    case "day":
      return { screen: "day", date, saved: q.get("saved") ?? undefined };
  }
  return { screen: "day", date: todayKey() };
}

export function href(route: Route): string {
  switch (route.screen) {
    case "day":
      return `#/day/${route.date}` + (route.saved ? `?saved=${route.saved}` : "");
    case "week":
      return `#/week/${route.date}`;
    case "new":
      return `#/new?date=${route.date}` + (route.time ? `&time=${route.time}` : "");
    case "edit":
      return `#/edit/${route.id}`;
  }
}

/** replace — не оставлять текущий экран в истории (после сохранения формы «назад» не вернёт в неё). */
export function go(route: Route, opts: { replace?: boolean } = {}) {
  if (opts.replace) location.replace(href(route));
  else location.hash = href(route);
}

export function useRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parseRoute(hash);
}
