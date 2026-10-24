import { useEffect, useState } from "react";
import { todayKey, type DayKey } from "./time.ts";

/**
 * Маршруты в hash, чтобы кнопка «назад» на телефоне работала и офлайн-PWA не нуждалась в настройке сервера.
 *   #/day/2026-10-26?saved=<id>   #/week/2026-10-26   #/new?date=2026-10-26&time=10:30&client=<id>   #/edit/<id>
 *   #/clients   #/client/<id|new>   #/import   #/services   #/service/<id|new>   #/settings
 */
export type Route =
  | { screen: "day"; date: DayKey; saved?: string }
  | { screen: "week"; date: DayKey }
  | { screen: "new"; date: DayKey; time?: string; client?: string }
  | { screen: "edit"; id: string }
  | { screen: "clients" }
  | { screen: "client"; id: string }
  | { screen: "import" }
  | { screen: "services" }
  | { screen: "service"; id: string }
  | { screen: "settings" };

export type Tab = "calendar" | "clients" | "services" | "settings";

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
      return {
        screen: "new",
        date: DATE.test(date) ? date : todayKey(),
        time: q.get("time") ?? undefined,
        client: q.get("client") ?? undefined,
      };
    case "edit":
      if (arg) return { screen: "edit", id: arg };
      break;
    case "day":
      return { screen: "day", date, saved: q.get("saved") ?? undefined };
    case "clients":
    case "import":
    case "services":
    case "settings":
      return { screen };
    case "client":
    case "service":
      if (arg) return { screen, id: arg };
      break;
  }
  return { screen: "day", date: todayKey() };
}

export function href(route: Route): string {
  switch (route.screen) {
    case "day":
      return `#/day/${route.date}` + (route.saved ? `?saved=${route.saved}` : "");
    case "week":
      return `#/week/${route.date}`;
    case "new": {
      const q = new URLSearchParams({ date: route.date });
      if (route.time) q.set("time", route.time);
      if (route.client) q.set("client", route.client);
      return `#/new?${q}`;
    }
    case "edit":
    case "client":
    case "service":
      return `#/${route.screen}/${route.id}`;
    default:
      return `#/${route.screen}`;
  }
}

export function tabOf(route: Route): Tab | undefined {
  switch (route.screen) {
    case "day":
    case "week":
      return "calendar";
    case "clients":
      return "clients";
    case "services":
      return "services";
    case "settings":
      return "settings";
  }
}

/** replace — не оставлять текущий экран в истории (после сохранения формы «назад» не вернёт в неё). */
export function go(route: Route, opts: { replace?: boolean } = {}) {
  if (opts.replace) location.replace(href(route));
  else location.hash = href(route);
}

/** Закрыть экран: назад по истории, а если приложение открыли сразу на нём — на запасной экран. */
export function back(fallback: Route) {
  if (history.length > 1) history.back();
  else go(fallback, { replace: true });
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
