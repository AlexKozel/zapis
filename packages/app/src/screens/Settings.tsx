import { useState } from "react";
import { mergeById, type Country, type Syncable, type WorkRange } from "@zapis/core";
import { CURRENCY, db, putRows, type Rows, type SyncTable } from "../db.ts";
import { saveSettings, useSettings } from "../data.ts";
import { LANGS, t, type UiLang } from "../i18n/index.ts";
import { addDays, fmtDate, fmtWeekdayLong, todayKey, weekStart } from "../time.ts";
import { TopBar } from "../ui.tsx";

const HM = /^\d{2}:\d{2}$/;
const CURRENCIES = ["BYN", "PLN", "EUR", "USD"];
const TABLES: SyncTable[] = ["services", "clients", "appointments"];

export function SettingsScreen() {
  return (
    <div className="screen">
      <TopBar title={t.settings.title} large />
      <main className="content stack">
        <Backup />
        <WorkHours />
        <Region />
      </main>
    </div>
  );
}

function WorkHours() {
  const settings = useSettings();
  const monday = weekStart(todayKey());

  function setDay(day: string, ranges: WorkRange[]) {
    // Пустое или недописанное время не сохраняем: календарь и поиск окон ждут строгий "HH:MM".
    if (ranges.some((r) => !HM.test(r.from) || !HM.test(r.to))) return;
    void saveSettings({ workHours: { ...settings.workHours, [day]: ranges } });
  }

  return (
    <section>
      <h2>{t.settings.workHours}</h2>
      <div className="hours-list">
        {Array.from({ length: 7 }, (_, i) => {
          const day = String(i + 1);
          const ranges = settings.workHours[day] ?? [];
          return (
            <div key={day} className="hours-day">
              <span className="hours-name">{fmtWeekdayLong(addDays(monday, i))}</span>
              <div className="hours-ranges">
                {ranges.length === 0 && <span className="muted">{t.settings.dayOff}</span>}
                {ranges.map((r, k) => (
                  <div key={k} className="hours-range">
                    <input
                      type="time"
                      step={900}
                      value={r.from}
                      onChange={(e) => setDay(day, ranges.map((x, j) => (j === k ? { ...x, from: e.target.value } : x)))}
                    />
                    –
                    <input
                      type="time"
                      step={900}
                      value={r.to}
                      onChange={(e) => setDay(day, ranges.map((x, j) => (j === k ? { ...x, to: e.target.value } : x)))}
                    />
                    <button
                      className="icon-btn small"
                      aria-label={t.settings.removeRange}
                      onClick={() => setDay(day, ranges.filter((_, j) => j !== k))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  className="link-btn"
                  onClick={() => {
                    const last = ranges.at(-1);
                    setDay(day, [...ranges, last ? { from: last.to, to: "19:00" > last.to ? "19:00" : last.to } : { from: "09:00", to: "19:00" }]);
                  }}
                >
                  {t.settings.addRange}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Region() {
  const settings = useSettings();
  return (
    <section>
      <h2>{t.settings.region}</h2>
      <div className="fields">
        <label>
          {t.settings.language}
          <select value={settings.lang} onChange={(e) => saveSettings({ lang: e.target.value as UiLang })}>
            {(Object.keys(LANGS) as UiLang[]).map((l) => (
              <option key={l} value={l}>
                {LANGS[l].name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.settings.country}
          <select
            value={settings.country}
            onChange={(e) => {
              const country = e.target.value as Country;
              void saveSettings({ country, currency: CURRENCY[country] });
            }}
          >
            {(Object.keys(CURRENCY) as Country[]).map((c) => (
              <option key={c} value={c}>
                {t.settings.countries[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.settings.currency}
          <select value={settings.currency} onChange={(e) => saveSettings({ currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

interface BackupFile {
  app: "zapis";
  version: 1;
  exportedAt: number;
  services: Rows["services"][];
  clients: Rows["clients"][];
  appointments: Rows["appointments"][];
}

/**
 * Резервная копия в файл. До синхронизации (неделя 3) данные живут только в этом телефоне,
 * а iPhone удаляет их вместе с иконкой приложения, поэтому копия — обязательная страховка.
 */
function Backup() {
  const settings = useSettings();
  const [message, setMessage] = useState("");

  async function save() {
    const data: BackupFile = {
      app: "zapis",
      version: 1,
      exportedAt: Date.now(),
      services: await db.services.toArray(),
      clients: await db.clients.toArray(),
      appointments: await db.appointments.toArray(),
    };
    const name = `zapis-${todayKey()}.json`;
    const file = new File([JSON.stringify(data)], name, { type: "application/json" });
    try {
      // На iPhone «Поделиться» даёт сохранить файл в «Файлы» или отправить себе в Telegram.
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
      else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      await saveSettings({ lastBackupAt: Date.now() });
    } catch {
      // Мастер закрыл окно «Поделиться» — копия не сохранена, отмечать нечего.
    }
  }

  async function restore(file: File) {
    try {
      const data = JSON.parse(await file.text()) as Partial<BackupFile>;
      if (data.app !== "zapis") throw new Error("not a backup");
      // Чистый телефон (новый или после переустановки) уже создал стартовые услуги — иначе после
      // восстановления каждая услуга будет в списке дважды. Заменяем их услугами из копии.
      const pristine = (await db.clients.count()) === 0 && (await db.appointments.count()) === 0;
      if (pristine && data.services?.length) {
        const now = Date.now();
        await putRows("services", (await db.services.toArray()).map((s) => ({ ...s, deleted: true, updatedAt: now })));
      }
      let changed = 0;
      for (const table of TABLES) {
        const remote = (data[table] ?? []) as Syncable[];
        const local = (await db.table(table).toArray()) as Syncable[];
        // Как при синхронизации: побеждает последнее изменение, более новые данные телефона не затираются.
        const { merged } = mergeById(local, remote);
        const incoming = new Set(remote);
        const winners = merged.filter((r) => incoming.has(r));
        await putRows(table, winners as Rows[typeof table][]);
        changed += winners.length;
      }
      setMessage(t.settings.restored(changed));
    } catch {
      setMessage(t.settings.badBackup);
    }
  }

  return (
    <section>
      <h2>{t.settings.backup}</h2>
      <p className="hint">{t.settings.backupHint}</p>
      <p className={settings.lastBackupAt ? "small" : "small warn"}>
        {settings.lastBackupAt ? t.settings.lastBackup(fmtDate(settings.lastBackupAt)) : t.settings.neverBacked}
      </p>
      <div className="toolbar">
        <button className="btn primary" onClick={save}>
          {t.settings.backupSave}
        </button>
        <label className="btn">
          {t.settings.backupRestore}
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void restore(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {message && <p className="small">{message}</p>}
    </section>
  );
}
