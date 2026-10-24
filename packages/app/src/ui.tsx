import { useEffect, useState, type ReactNode } from "react";
import { t } from "./i18n/index.ts";
import { go, type Tab } from "./router.ts";
import { todayKey } from "./time.ts";

/** Общие элементы экранов. */

export function TopBar(props: { title: ReactNode; left?: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-row">
        {props.left ?? <span className="icon-btn" />}
        <h1 className="topbar-title">{props.title}</h1>
        {props.right ?? <span className="icon-btn" />}
      </div>
      {props.children}
    </header>
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="icon-btn" aria-label={t.common.close} onClick={onClick}>
      ✕
    </button>
  );
}

export function TabBar({ active }: { active: Tab }) {
  const tabs: { tab: Tab; label: string; icon: string; open: () => void }[] = [
    { tab: "calendar", label: t.nav.calendar, icon: "▦", open: () => go({ screen: "day", date: todayKey() }) },
    { tab: "clients", label: t.nav.clients, icon: "☺", open: () => go({ screen: "clients" }) },
    { tab: "services", label: t.nav.services, icon: "✂", open: () => go({ screen: "services" }) },
    { tab: "settings", label: t.nav.settings, icon: "⚙", open: () => go({ screen: "settings" }) },
  ];
  return (
    <nav className="tabbar">
      {tabs.map((x) => (
        <button key={x.tab} aria-current={x.tab === active ? "page" : undefined} onClick={x.open}>
          <span aria-hidden="true">{x.icon}</span>
          {x.label}
        </button>
      ))}
    </nav>
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
      {t.offline}
    </div>
  );
}
