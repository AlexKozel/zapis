import { useEffect, useState } from "react";
import { MINUTE, freeWindows, isActive, occupied, parseHm, type Appointment, type AppointmentStatus } from "@zapis/core";
import { db, saveRow } from "../db.ts";
import { byId, useAppointments, useClients, useServices, useSettings, workRangesFor } from "../data.ts";
import { go } from "../router.ts";
import {
  addDays,
  anchor,
  dayBounds,
  fmtDay,
  fmtDuration,
  fmtMoney,
  fmtShortDay,
  fmtTime,
  hm,
  minutesInDay,
  todayKey,
  weekStart,
  type DayKey,
} from "../time.ts";

const PX_PER_MIN = 1.2;
const SNAP_MIN = 15;
/** Окна короче не подсвечиваем: в них ничего, кроме консультации, не поставить. */
const FREE_WINDOW_MIN = 30;

export function CalendarScreen(props: { view: "day" | "week"; date: DayKey; saved?: string }) {
  const { view, date } = props;
  const step = view === "day" ? 1 : 7;
  const title =
    view === "day" ? fmtDay(date) : `${fmtShortDay(weekStart(date))} – ${fmtShortDay(addDays(weekStart(date), 6))}`;

  return (
    <div className="screen">
      <header className="topbar">
        <div className="topbar-row">
          <button className="icon-btn" aria-label="Назад" onClick={() => go({ screen: view, date: addDays(date, -step) })}>
            ‹
          </button>
          <h1 className="topbar-title">{title}</h1>
          <button className="icon-btn" aria-label="Вперёд" onClick={() => go({ screen: view, date: addDays(date, step) })}>
            ›
          </button>
        </div>
        <div className="topbar-row">
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={view === "day"} onClick={() => go({ screen: "day", date })}>
              День
            </button>
            <button role="tab" aria-selected={view === "week"} onClick={() => go({ screen: "week", date })}>
              Неделя
            </button>
          </div>
          <button className="link-btn" onClick={() => go({ screen: view, date: todayKey() })}>
            Сегодня
          </button>
        </div>
      </header>

      {view === "day" ? <DayView date={date} highlight={props.saved} /> : <WeekView date={date} />}

      <button className="fab" onClick={() => go({ screen: "new", date })}>
        + Запись
      </button>
      {props.saved && <SavedToast id={props.saved} date={date} />}
    </div>
  );
}

function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Раскладка пересекающихся (параллельных) записей по дорожкам, чтобы они не закрывали друг друга. */
function layoutLanes(items: Appointment[]): Map<string, { lane: number; lanes: number }> {
  const result = new Map<string, { lane: number; lanes: number }>();
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    for (const c of cluster) result.set(c.id, { lane: c.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const a of [...items].sort((x, y) => x.start - y.start)) {
    const occ = occupied(a);
    if (occ.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= occ.start);
    if (lane === -1) lane = laneEnds.push(occ.end) - 1;
    else laneEnds[lane] = occ.end;
    cluster.push({ id: a.id, lane });
    clusterEnd = Math.max(clusterEnd, occ.end);
  }
  flush();
  return result;
}

function DayView({ date, highlight }: { date: DayKey; highlight?: string }) {
  const settings = useSettings();
  const appointments = useAppointments(date);
  const clients = byId(useClients());
  const services = byId(useServices());
  const now = useNow();
  const [opened, setOpened] = useState<Appointment | null>(null);

  const ranges = workRangesFor(settings, date);
  const active = (appointments ?? []).filter(isActive);
  const inactive = (appointments ?? []).filter((a) => !isActive(a));

  // Сетка — рабочие часы, расширенные до записей вне них; по умолчанию 9–19.
  const marks = [
    ...ranges.flatMap((r) => [parseHm(r.from), parseHm(r.to)]),
    ...active.flatMap((a) => [minutesInDay(date, a.start), minutesInDay(date, occupied(a).end)]),
  ];
  const from = Math.max(0, Math.floor((marks.length ? Math.min(...marks) : 9 * 60) / 60) * 60);
  const to = Math.min(24 * 60, Math.ceil((marks.length ? Math.max(...marks) : 19 * 60) / 60) * 60);
  const y = (min: number) => (min - from) * PX_PER_MIN;
  const lanes = layoutLanes(active);
  const nowMin = minutesInDay(date, now);
  const windows = freeWindows({
    dayStart: anchor(date),
    workRanges: ranges,
    appointments: active,
    minMin: FREE_WINDOW_MIN,
    notBefore: now,
  });

  function onGridClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const min = from + (e.clientY - rect.top) / PX_PER_MIN;
    const snapped = Math.floor(min / SNAP_MIN) * SNAP_MIN;
    go({ screen: "new", date, time: hm(Math.min(Math.max(snapped, 0), 24 * 60 - SNAP_MIN)) });
  }

  return (
    <main className="content">
      {ranges.length === 0 && <p className="hint">Выходной. Записать всё равно можно — нажмите на время.</p>}
      <div className="day-grid">
        <div className="hours" style={{ height: y(to) }}>
          {Array.from({ length: (to - from) / 60 + 1 }, (_, i) => (
            <span key={i} style={{ top: i * 60 * PX_PER_MIN }}>
              {hm(from + i * 60)}
            </span>
          ))}
        </div>
        <div className="lane-area" style={{ height: y(to) }} onClick={onGridClick}>
          {ranges.map((r) => (
            <div
              key={r.from}
              className="work-range"
              style={{ top: y(parseHm(r.from)), height: (parseHm(r.to) - parseHm(r.from)) * PX_PER_MIN }}
            />
          ))}
          {Array.from({ length: (to - from) / 60 }, (_, i) => (
            <div key={i} className="hour-line" style={{ top: i * 60 * PX_PER_MIN }} />
          ))}
          {windows.map((w) => {
            const s = minutesInDay(date, w.start);
            const e = minutesInDay(date, w.end);
            return (
              <div key={w.start} className="free-window" style={{ top: y(s), height: (e - s) * PX_PER_MIN }}>
                <span>свободно {fmtDuration(e - s)}</span>
              </div>
            );
          })}
          {nowMin >= from && nowMin <= to && <div className="now-line" style={{ top: y(nowMin) }} />}

          {active.map((a) => {
            const pos = lanes.get(a.id) ?? { lane: 0, lanes: 1 };
            const startMin = minutesInDay(date, a.start);
            const durMin = (a.end - a.start) / MINUTE;
            const client = clients.get(a.clientId);
            const service = services.get(a.serviceId);
            return (
              <button
                key={a.id}
                className={`appt status-${a.status}` + (a.id === highlight ? " highlight" : "")}
                style={{
                  top: y(startMin),
                  height: durMin * PX_PER_MIN,
                  left: `${(pos.lane / pos.lanes) * 100}%`,
                  width: `calc(${100 / pos.lanes}% - 4px)`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpened(a);
                }}
              >
                <span className="appt-time">
                  {fmtTime(a.start)}–{fmtTime(a.end)}
                  {a.parallel && <span className="badge" title="Поставлена параллельно">∥</span>}
                </span>
                <span className="appt-client">{client?.name ?? "Клиент"}</span>
                {durMin >= 45 && <span className="appt-service">{service?.name}</span>}
                {a.bufferAfterMin > 0 && (
                  <span className="appt-buffer" style={{ height: a.bufferAfterMin * PX_PER_MIN }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {inactive.length > 0 && (
        <section className="inactive">
          <h2>Отмены и неявки</h2>
          {inactive.map((a) => (
            <button key={a.id} className="row" onClick={() => setOpened(a)}>
              <span>{fmtTime(a.start)}</span>
              <span className="grow">{clients.get(a.clientId)?.name}</span>
              <span className="muted">{STATUS_LABEL[a.status]}</span>
            </button>
          ))}
        </section>
      )}

      {opened && (
        <AppointmentSheet
          appointment={(appointments ?? []).find((a) => a.id === opened.id) ?? opened}
          onClose={() => setOpened(null)}
        />
      )}
    </main>
  );
}

/** Занятое время дня без двойного счёта параллельных записей. */
function busyMinutes(list: Appointment[]): number {
  let total = 0;
  let coveredUntil = -Infinity;
  for (const a of [...list].sort((x, y) => x.start - y.start)) {
    const from = Math.max(a.start, coveredUntil);
    if (a.end > from) total += a.end - from;
    coveredUntil = Math.max(coveredUntil, a.end);
  }
  return Math.round(total / MINUTE);
}

function WeekView({ date }: { date: DayKey }) {
  const monday = weekStart(date);
  const settings = useSettings();
  const appointments = useAppointments(monday, 7);
  const clients = byId(useClients());
  const today = todayKey();
  const now = useNow();

  return (
    <main className="content week">
      {Array.from({ length: 7 }, (_, i) => {
        const day = addDays(monday, i);
        const { start, end } = dayBounds(day);
        const list = (appointments ?? []).filter((a) => isActive(a) && a.start < end && a.end > start);
        const workMin = workRangesFor(settings, day).reduce((s, r) => s + parseHm(r.to) - parseHm(r.from), 0);
        const busyMin = busyMinutes(list);
        const free = freeWindows({
          dayStart: anchor(day),
          workRanges: workRangesFor(settings, day),
          appointments: list,
          minMin: 60,
          notBefore: now,
        });
        return (
          <button key={day} className={"week-day" + (day === today ? " today" : "")} onClick={() => go({ screen: "day", date: day })}>
            <div className="week-day-head">
              <strong>{fmtShortDay(day)}</strong>
              <span className="muted">
                {workMin === 0
                  ? "выходной"
                  : busyMin === 0
                    ? `свободно ${fmtDuration(workMin)}`
                    : `занято ${fmtDuration(busyMin)} из ${fmtDuration(workMin)}`}
              </span>
            </div>
            {workMin > 0 && (
              <div className="meter">
                <div style={{ width: `${Math.min(100, (busyMin / workMin) * 100)}%` }} />
              </div>
            )}
            <div className="chips">
              {list.map((a) => (
                <span key={a.id} className="chip">
                  {fmtTime(a.start)} {clients.get(a.clientId)?.name}
                </span>
              ))}
              {list.length > 0 && free.map((w) => (
                <span key={w.start} className="chip free">
                  свободно {fmtTime(w.start)}–{fmtTime(w.end)}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </main>
  );
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "запланирована",
  done: "пришла",
  cancelled: "отменена",
  no_show: "не пришла",
};

function AppointmentSheet({ appointment: a, onClose }: { appointment: Appointment; onClose: () => void }) {
  const clients = byId(useClients());
  const services = byId(useServices());
  const settings = useSettings();
  const client = clients.get(a.clientId);
  const service = services.get(a.serviceId);

  async function setStatus(status: AppointmentStatus) {
    await saveRow("appointments", { ...a, status });
    onClose();
  }
  async function remove() {
    if (!confirm("Удалить запись? Её не будет ни в календаре, ни в истории клиента.")) return;
    await saveRow("appointments", { ...a, deleted: true });
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{client?.name ?? "Клиент"}</h2>
        {client?.phone && (
          <a className="phone" href={`tel:${client.phone}`}>
            {client.phone}
          </a>
        )}
        <p>
          {service?.name} · {fmtTime(a.start)}–{fmtTime(a.end)}
          {a.bufferAfterMin > 0 && <span className="muted"> (+{a.bufferAfterMin} мин запас)</span>}
        </p>
        <p>
          {fmtMoney(a.price, settings.currency)} · <span className="muted">{STATUS_LABEL[a.status]}</span>
          {a.parallel && <span className="muted"> · параллельно</span>}
        </p>
        {a.note && <p className="note">{a.note}</p>}

        <div className="actions">
          {a.status === "scheduled" ? (
            <>
              <button className="btn primary" onClick={() => setStatus("done")}>Пришла</button>
              <button className="btn" onClick={() => go({ screen: "edit", id: a.id })}>Перенести / изменить</button>
              <button className="btn" onClick={() => setStatus("no_show")}>Не пришла</button>
              <button className="btn" onClick={() => setStatus("cancelled")}>Отменить</button>
            </>
          ) : (
            <button className="btn" onClick={() => setStatus("scheduled")}>Вернуть в план</button>
          )}
          <button className="btn danger" onClick={remove}>Удалить</button>
        </div>
      </div>
    </div>
  );
}

/** После быстрой записи — подтверждение с возможностью отменить, если нажали не на то окно. */
function SavedToast({ id, date }: { id: string; date: DayKey }) {
  useEffect(() => {
    const t = setTimeout(() => go({ screen: "day", date }, { replace: true }), 6000);
    return () => clearTimeout(t);
  }, [id, date]);

  async function undo() {
    const a = await db.appointments.get(id);
    if (a) await saveRow("appointments", { ...a, deleted: true });
    go({ screen: "day", date }, { replace: true });
  }

  return (
    <div className="toast" role="status">
      <span>Записано</span>
      <button className="link-btn" onClick={undo}>Отменить</button>
    </div>
  );
}
