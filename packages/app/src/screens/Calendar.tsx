import { useEffect, useState } from "react";
import { MINUTE, freeWindows, isActive, occupied, parseHm, type Appointment, type AppointmentStatus } from "@zapis/core";
import { db, saveRow } from "../db.ts";
import { byId, useAppointments, useClients, useServices, useSettings, workRangesFor } from "../data.ts";
import { t } from "../i18n/index.ts";
import { go } from "../router.ts";
import { Plus } from "lucide-react";
import { ArrowButton, serviceStyle, TopBar } from "../ui.tsx";
import { ContactLinks } from "./Clients.tsx";
import {
  addDays,
  addMonths,
  anchor,
  dayBounds,
  dayDiff,
  dayOfMonth,
  fmtHours,
  fmtMonth,
  fmtWeekday,
  monthStart,
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
/** Записи короче — в одну строку. */
const COMPACT_MIN = 40;

type View = "day" | "week" | "month";

/** Соседний день, неделя или месяц — для стрелок в заголовке. */
function shift(view: View, date: DayKey, dir: 1 | -1): DayKey {
  if (view === "month") return addMonths(date, dir);
  return addDays(date, view === "day" ? dir : 7 * dir);
}

export function CalendarScreen(props: { view: View; date: DayKey; saved?: string }) {
  const { view, date } = props;
  const title =
    view === "day"
      ? fmtDay(date)
      : view === "week"
        ? `${fmtShortDay(weekStart(date))} – ${fmtShortDay(addDays(weekStart(date), 6))}`
        : fmtMonth(date);

  return (
    <div className="screen">
      <TopBar
        title={title}
        left={<ArrowButton dir="back" onClick={() => go({ screen: view, date: shift(view, date, -1) })} />}
        right={<ArrowButton dir="forward" onClick={() => go({ screen: view, date: shift(view, date, 1) })} />}
      >
        <div className="topbar-row">
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={view === "day"} onClick={() => go({ screen: "day", date })}>
              {t.calendar.day}
            </button>
            <button role="tab" aria-selected={view === "week"} onClick={() => go({ screen: "week", date })}>
              {t.calendar.week}
            </button>
            <button role="tab" aria-selected={view === "month"} onClick={() => go({ screen: "month", date })}>
              {t.calendar.month}
            </button>
          </div>
          <button className="link-btn" onClick={() => go({ screen: view, date: todayKey() })}>
            {t.calendar.today}
          </button>
        </div>
      </TopBar>

      {view === "day" && <DayView date={date} highlight={props.saved} />}
      {view === "week" && <WeekView date={date} />}
      {view === "month" && <MonthView date={date} />}

      <button className="fab" onClick={() => go({ screen: "new", date })}>
        <Plus size={20} strokeWidth={2.5} />
        {t.calendar.add}
      </button>
      {props.saved && <SavedToast id={props.saved} date={date} />}
    </div>
  );
}

function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
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
      {ranges.length === 0 && <p className="hint">{t.calendar.dayOff}</p>}
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
                <span>{t.calendar.free(fmtDuration(e - s))}</span>
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
                className={
                  `appt status-${a.status}` +
                  (durMin < COMPACT_MIN ? " compact" : "") +
                  (a.id === highlight ? " highlight" : "")
                }
                style={{
                  ...serviceStyle(service),
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
                {durMin < COMPACT_MIN ? (
                  // Короткая запись (консультация) — в одну строку, иначе текст не помещается в блок.
                  <span className="appt-client">
                    <span className="appt-time">{fmtTime(a.start)}</span> {client?.name ?? t.calendar.client}
                  </span>
                ) : (
                  <>
                    <span className="appt-time">
                      {fmtTime(a.start)}–{fmtTime(a.end)}
                      {a.parallel && <span className="badge" title={t.calendar.parallel}>∥</span>}
                    </span>
                    <span className="appt-client">{client?.name ?? t.calendar.client}</span>
                    {durMin >= 60 && <span className="appt-service">{service?.name}</span>}
                  </>
                )}
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
          <h2>{t.calendar.inactive}</h2>
          {inactive.map((a) => (
            <button key={a.id} className="row" onClick={() => setOpened(a)}>
              <span>{fmtTime(a.start)}</span>
              <span className="grow">{clients.get(a.clientId)?.name}</span>
              <span className="muted">{t.status[a.status]}</span>
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
  const services = byId(useServices());
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
                  ? t.calendar.weekDayOff
                  : busyMin === 0
                    ? t.calendar.free(fmtDuration(workMin))
                    : t.calendar.busyOf(fmtDuration(busyMin), fmtDuration(workMin))}
              </span>
            </div>
            {workMin > 0 && (
              <div className="meter">
                <div style={{ width: `${Math.min(100, (busyMin / workMin) * 100)}%` }} />
              </div>
            )}
            <div className="chips">
              {list.map((a) => (
                <span key={a.id} className="chip appt-chip" style={serviceStyle(services.get(a.serviceId))}>
                  {fmtTime(a.start)} {clients.get(a.clientId)?.name}
                </span>
              ))}
              {list.length > 0 && free.map((w) => (
                <span key={w.start} className="chip free">
                  {t.calendar.freeRange(fmtTime(w.start), fmtTime(w.end))}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </main>
  );
}

/**
 * Месяц: колористу нужно найти день под длинное окрашивание, поэтому в каждом дне — загрузка
 * и самое длинное свободное окно, а не список записей.
 */
function MonthView({ date }: { date: DayKey }) {
  const settings = useSettings();
  const first = monthStart(date);
  const gridStart = weekStart(first);
  const weeks = Math.ceil(dayDiff(gridStart, addMonths(first, 1)) / 7);
  const appointments = useAppointments(gridStart, weeks * 7);
  const today = todayKey();
  const now = useNow();

  return (
    <main className="content">
      <div className="month">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="month-wd">
            {fmtWeekday(addDays(gridStart, i))}
          </span>
        ))}
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const day = addDays(gridStart, i);
          const { start, end } = dayBounds(day);
          const ranges = workRangesFor(settings, day);
          const list = (appointments ?? []).filter((a) => isActive(a) && a.start < end && a.end > start);
          const workMin = ranges.reduce((s, r) => s + parseHm(r.to) - parseHm(r.from), 0);
          const longest = freeWindows({ dayStart: anchor(day), workRanges: ranges, appointments: list, notBefore: now }).reduce(
            (m, w) => Math.max(m, (w.end - w.start) / MINUTE),
            0,
          );
          const classes = ["month-day"];
          if (day.slice(0, 7) !== first.slice(0, 7)) classes.push("other");
          if (day === today) classes.push("today");
          if (workMin === 0) classes.push("off");
          return (
            <button key={day} className={classes.join(" ")} onClick={() => go({ screen: "day", date: day })}>
              <span className="month-num">{dayOfMonth(day)}</span>
              {workMin > 0 && (
                <span className="meter">
                  <span style={{ width: `${Math.min(100, (busyMinutes(list) / workMin) * 100)}%` }} />
                </span>
              )}
              {list.length > 0 && <span className="month-count">{list.length}</span>}
              {/* У пустого дня свободен весь день — это видно по пустой полоске, число только шумит. */}
              {list.length > 0 && longest >= 60 && <span className="month-free">{fmtHours(longest)}</span>}
            </button>
          );
        })}
      </div>
      <p className="hint small">{t.calendar.monthLegend}</p>
    </main>
  );
}

function AppointmentSheet({ appointment: a, onClose }: { appointment: Appointment; onClose: () => void }) {
  const clients = byId(useClients());
  const services = byId(useServices());
  const settings = useSettings();
  const client = clients.get(a.clientId);
  const service = services.get(a.serviceId);
  // «Пришла» спрашивает фактическую сумму: у услуг «от–до» ожидаемая цена — только прикидка, а итоги считаются по факту.
  const [amount, setAmount] = useState<string | null>(null);

  async function setStatus(status: AppointmentStatus, price = a.price) {
    await saveRow("appointments", { ...a, status, price });
    onClose();
  }
  async function remove() {
    if (!confirm(t.sheet.deleteConfirm)) return;
    await saveRow("appointments", { ...a, deleted: true });
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <span className="sheet-handle" aria-hidden="true" />
        <h2>{client?.name ?? t.calendar.client}</h2>
        {client && <ContactLinks client={client} />}
        <p>
          {service?.name} · {fmtTime(a.start)}–{fmtTime(a.end)}
          {a.bufferAfterMin > 0 && <span className="muted"> ({t.sheet.buffer(a.bufferAfterMin)})</span>}
        </p>
        <p>
          {fmtMoney(a.price, settings.currency)} · <span className="muted">{t.status[a.status]}</span>
          {a.parallel && <span className="muted"> · {t.sheet.parallel}</span>}
        </p>
        {a.note && <p className="note">{a.note}</p>}

        {amount !== null ? (
          <form
            className="pay"
            onSubmit={(e) => {
              e.preventDefault();
              void setStatus("done", Math.round((Number(amount.replace(",", ".")) || 0) * 100));
            }}
          >
            <label>
              {t.sheet.amount(settings.currency)}
              <input type="text" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <button className="btn primary" type="submit">
              {t.common.done}
            </button>
          </form>
        ) : (
          <div className="actions">
            {a.status === "scheduled" ? (
              <>
                <button className="btn primary" onClick={() => setAmount(String(a.price / 100))}>
                  {t.sheet.came}
                </button>
                <button className="btn" onClick={() => go({ screen: "edit", id: a.id })}>
                  {t.sheet.reschedule}
                </button>
                <button className="btn" onClick={() => setStatus("no_show")}>
                  {t.sheet.noShow}
                </button>
                <button className="btn" onClick={() => setStatus("cancelled")}>
                  {t.sheet.cancel}
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => setStatus("scheduled")}>
                {t.sheet.restore}
              </button>
            )}
            {client && (
              <button className="btn" onClick={() => go({ screen: "client", id: client.id })}>
                {t.sheet.openClient}
              </button>
            )}
            <button className="btn danger" onClick={remove}>
              {t.common.delete}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** После быстрой записи — подтверждение с возможностью отменить, если нажали не на то окно. */
function SavedToast({ id, date }: { id: string; date: DayKey }) {
  useEffect(() => {
    const timer = setTimeout(() => go({ screen: "day", date }, { replace: true }), 6000);
    return () => clearTimeout(timer);
  }, [id, date]);

  async function undo() {
    const a = await db.appointments.get(id);
    if (a) await saveRow("appointments", { ...a, deleted: true });
    go({ screen: "day", date }, { replace: true });
  }

  return (
    <div className="toast" role="status">
      <span>{t.calendar.saved}</span>
      <button className="link-btn" onClick={undo}>
        {t.common.undo}
      </button>
    </div>
  );
}
