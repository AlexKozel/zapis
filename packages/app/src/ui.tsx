import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Scissors, Settings, Users, WifiOff, X } from "lucide-react";
import type { Service } from "@zapis/core";
import { t } from "./i18n/index.ts";
import { go, type Tab } from "./router.ts";
import { todayKey } from "./time.ts";

/** Общие элементы экранов. */

/**
 * Верхняя панель. `large` — крупный заголовок под панелью, как на корневых экранах iPhone
 * (Клиенты, Услуги, Настройки); без него заголовок по центру панели.
 */
export function TopBar(props: { title: ReactNode; left?: ReactNode; right?: ReactNode; large?: boolean; children?: ReactNode }) {
  return (
    <header className={"topbar" + (props.large ? " large" : "")}>
      <div className="topbar-row">
        {props.left ?? <span className="icon-btn" />}
        {!props.large && <h1 className="topbar-title">{props.title}</h1>}
        {props.right ?? <span className="icon-btn" />}
      </div>
      {props.large && <h1 className="large-title">{props.title}</h1>}
      {props.children}
    </header>
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="icon-btn" aria-label={t.common.close} onClick={onClick}>
      <X size={22} />
    </button>
  );
}

export function ArrowButton({ dir, onClick }: { dir: "back" | "forward"; onClick: () => void }) {
  return (
    <button className="icon-btn" aria-label={dir === "back" ? t.common.back : t.common.forward} onClick={onClick}>
      {dir === "back" ? <ChevronLeft size={24} /> : <ChevronRight size={24} />}
    </button>
  );
}

export function TabBar({ active }: { active: Tab }) {
  const tabs: { tab: Tab; label: string; icon: ReactNode; open: () => void }[] = [
    { tab: "calendar", label: t.nav.calendar, icon: <CalendarDays />, open: () => go({ screen: "day", date: todayKey() }) },
    { tab: "clients", label: t.nav.clients, icon: <Users />, open: () => go({ screen: "clients" }) },
    { tab: "services", label: t.nav.services, icon: <Scissors />, open: () => go({ screen: "services" }) },
    { tab: "settings", label: t.nav.settings, icon: <Settings />, open: () => go({ screen: "settings" }) },
  ];
  return (
    <nav className="tabbar">
      {tabs.map((x) => (
        <button key={x.tab} aria-current={x.tab === active ? "page" : undefined} onClick={x.open}>
          {x.icon}
          {x.label}
        </button>
      ))}
    </nav>
  );
}

/** Палитра услуг: оттенки подобраны так, чтобы соседние различались и не было кислотного жёлтого. */
export const PALETTE = [255, 160, 330, 25, 200, 285, 5, 185, 40, 225];

/** Устойчивый номер из строки: один и тот же клиент всегда одного цвета. */
function hashIndex(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % PALETTE.length;
}

const hueVar = (index: number) => ({ "--hue": PALETTE[index % PALETTE.length] }) as CSSProperties;

/** Цвет по строке — для аватаров клиентов. */
export function hueStyle(key: string): CSSProperties {
  return hueVar(hashIndex(key));
}

/** Цвет услуги: свой номер из палитры, у старых услуг без номера — по id. */
export function serviceStyle(service: Pick<Service, "id" | "color"> | undefined): CSSProperties {
  if (!service) return hueVar(0);
  return hueVar(service.color ?? hashIndex(service.id));
}

/** Первый цвет палитры, которого ещё нет у услуг, — для новой услуги. */
export function nextColor(services: Pick<Service, "color">[]): number {
  const used = new Set(services.map((s) => s.color));
  const free = PALETTE.findIndex((_, i) => !used.has(i));
  return free === -1 ? services.length % PALETTE.length : free;
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span className="avatar" style={{ ...hueStyle(name), width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Без связи приложение работает полностью; плашка только успокаивает, что ничего не теряется. */
export function OfflineBanner() {
  if (useOnline()) return null;
  return (
    <div className="offline" role="status">
      <WifiOff size={16} />
      {t.offline}
    </div>
  );
}
