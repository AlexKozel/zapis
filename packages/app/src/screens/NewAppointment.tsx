import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  MINUTE,
  checkBooking,
  freeSlots,
  normalizePhone,
  type Appointment,
  type BookingCheck,
  type Client,
  type Service,
} from "@zapis/core";
import { db, saveRow, uuid } from "../db.ts";
import { appointmentsInDays, byId, useAppointments, useClients, useServices, useSettings, workRangesFor } from "../data.ts";
import { t } from "../i18n/index.ts";
import { back, go } from "../router.ts";
import { CloseButton, serviceStyle, TopBar } from "../ui.tsx";
import { canPickContacts, pickContact } from "../contacts.ts";
import {
  addDays,
  anchor,
  atTime,
  dayKey,
  dayOfMonth,
  fmtDay,
  fmtDuration,
  fmtMoney,
  fmtShortDay,
  fmtTime,
  fmtWeekday,
  hm,
  minutesInDay,
  todayKey,
  type DayKey,
} from "../time.ts";

const SLOT_STEP_MIN = 15;
const DATE_STRIP_DAYS = 14;

interface Draft {
  clientId?: string;
  /** Новый клиент создаётся только при сохранении записи, чтобы не оставлять «пустых» клиентов. */
  newClient?: { name: string; phone: string };
  serviceId?: string;
  date: DayKey;
  time?: string;
  durationMin?: number;
  bufferAfterMin?: number;
  price?: number;
  note: string;
}

type Problem = Exclude<BookingCheck, { ok: true }>;

/** Длительность или цена «от–до»: мастер должен увидеть и выбрать их до сохранения. */
function isFlexible(s: Service): boolean {
  return s.durationMinMin !== s.durationMaxMin || s.priceMin !== s.priceMax;
}

/** Варианты длительности гибкой услуги: от минимума до максимума с шагом 30 минут. */
function durationOptions(s: Service): number[] {
  const result: number[] = [];
  for (let m = s.durationMinMin; m < s.durationMaxMin; m += 30) result.push(m);
  result.push(s.durationMaxMin);
  return result;
}

/** Редактирование: сначала дождаться записи из базы, потом открыть ту же форму. */
export function EditAppointmentScreen({ id }: { id: string }) {
  const base = useLiveQuery(() => db.appointments.get(id), [id], null);
  if (base === null) return null;
  if (!base || base.deleted) return <p className="hint">{t.form.notFound}</p>;
  const date = dayKey(base.start);
  return (
    <AppointmentForm
      base={base}
      initial={{
        clientId: base.clientId,
        serviceId: base.serviceId,
        date,
        time: hm(minutesInDay(date, base.start)),
        durationMin: (base.end - base.start) / MINUTE,
        bufferAfterMin: base.bufferAfterMin,
        price: base.price,
        note: base.note ?? "",
      }}
    />
  );
}

export function NewAppointmentScreen({ date, time, client }: { date: DayKey; time?: string; client?: string }) {
  return <AppointmentForm initial={{ date, time, clientId: client, note: "" }} />;
}

function AppointmentForm({ initial, base }: { initial: Draft; base?: Appointment }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const services = useServices();
  const settings = useSettings();

  const service = services?.find((s) => s.id === draft.serviceId);
  const durationMin = draft.durationMin ?? service?.durationMaxMin;
  const bufferAfterMin = draft.bufferAfterMin ?? service?.bufferAfterMin ?? 0;
  const price = draft.price ?? service?.priceMin ?? 0;
  const hasClient = !!draft.clientId || !!draft.newClient?.name.trim();
  const start = draft.time ? atTime(draft.date, draft.time) : undefined;

  const update = (patch: Partial<Draft>) => {
    setProblem(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  function pickService(s: Service) {
    // Длительность, запас и цена берутся из услуги заново; гибкая услуга — по максимуму, чтобы не было накладок.
    update({ serviceId: s.id, durationMin: undefined, bufferAfterMin: undefined, price: undefined });
  }

  async function save(at: number, allowParallel: boolean) {
    if (!service || !hasClient || durationMin === undefined || saving) return;
    const end = at + durationMin * MINUTE;
    const nearby = await appointmentsInDays(addDays(dayKey(at), -1), 3);
    const check = checkBooking(nearby, { id: base?.id, start: at, end, bufferAfterMin }, { allowParallel });
    if (!check.ok) {
      setProblem(check);
      return;
    }
    setSaving(true);
    try {
      const id = base?.id ?? uuid();
      await db.transaction("rw", db.clients, db.appointments, db.outbox, async () => {
        let clientId = draft.clientId;
        if (!clientId && draft.newClient) {
          const raw = draft.newClient.phone.trim();
          const phone = raw && (normalizePhone(raw, settings.country) ?? raw);
          const client = await saveRow("clients", {
            id: uuid(),
            name: draft.newClient.name.trim(),
            ...(phone ? { phone } : {}),
            reminderChannel: "none",
          });
          clientId = client.id;
        }
        const note = draft.note.trim();
        await saveRow("appointments", {
          ...base,
          id,
          clientId: clientId!,
          serviceId: service.id,
          start: at,
          end,
          bufferAfterMin,
          price,
          status: base?.status ?? "scheduled",
          parallel: check.parallel,
          note: note || undefined,
        });
      });
      go({ screen: "day", date: dayKey(at), saved: base ? undefined : id }, { replace: true });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Три нажатия: клиент → услуга → окно. Для услуги с фиксированными длительностью и ценой нажатие на окно
   * сразу сохраняет запись; для гибкой — только выбирает время, сохранение кнопкой «Записать».
   */
  function pickSlot(at: number) {
    update({ time: hm(minutesInDay(draft.date, at)) });
    if (hasClient && service && !isFlexible(service)) void save(at, false);
  }

  return (
    <div className="screen">
      <TopBar
        title={base ? t.form.titleEdit : t.form.titleNew}
        left={<CloseButton onClick={() => back({ screen: "day", date: draft.date })} />}
      />

      <main className="content form">
        <ClientStep draft={draft} update={update} autoFocus={!base} />

        <section className="step">
          <h2>{t.form.service}</h2>
          {service && (
            <div className="picked">
              <span>
                <strong>{service.name}</strong>{" "}
                <span className="muted">
                  {fmtDuration(durationMin ?? 0)} · {fmtMoney(price, settings.currency)}
                </span>
              </span>
              <button className="link-btn" onClick={() => update({ serviceId: undefined })}>
                {t.common.edit}
              </button>
            </div>
          )}
          {service && isFlexible(service) && (
            <div className="tune">
              {service.durationMinMin !== service.durationMaxMin && (
                <div className="tune-row" role="group" aria-label={t.form.durationMin}>
                  {durationOptions(service).map((m) => (
                    <button key={m} className="tune-chip" aria-pressed={durationMin === m} onClick={() => update({ durationMin: m })}>
                      {fmtDuration(m)}
                    </button>
                  ))}
                </div>
              )}
              {service.priceMin !== service.priceMax && (
                <label className="tune-price">
                  {t.form.price(settings.currency)}
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={price / 100}
                    onChange={(e) => update({ price: Math.round((Number(e.target.value) || 0) * 100) })}
                  />
                  <small className="muted">
                    {fmtMoney(service.priceMin, settings.currency)} – {fmtMoney(service.priceMax, settings.currency)}
                  </small>
                </label>
              )}
            </div>
          )}
          {!service && (
            <div className="options">
              {services?.map((s) => (
                <button key={s.id} className={"option" + (s.isConsultation ? " consult" : "")} onClick={() => pickService(s)}>
                  <strong>
                    <span className="swatch small" style={serviceStyle(s)} aria-hidden="true" />
                    {s.name}
                  </strong>
                  <span className="muted">
                    {s.durationMinMin === s.durationMaxMin
                      ? fmtDuration(s.durationMinMin)
                      : `${fmtDuration(s.durationMinMin)} – ${fmtDuration(s.durationMaxMin)}`}
                    {s.priceMax > 0 &&
                      " · " +
                        (s.priceMin === s.priceMax
                          ? fmtMoney(s.priceMin, settings.currency)
                          : `${fmtMoney(s.priceMin, settings.currency)}–${fmtMoney(s.priceMax, settings.currency)}`)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <TimeStep
          draft={draft}
          update={update}
          durationMin={durationMin}
          bufferAfterMin={bufferAfterMin}
          excludeId={base?.id}
          onPickSlot={pickSlot}
        />

        <section className="step">
          <button className="link-btn" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? t.form.detailsHide : t.form.detailsShow}
          </button>
          {showDetails && (
            <div className="details">
              <label>
                {t.form.durationMin}
                <input
                  type="number"
                  inputMode="numeric"
                  min={5}
                  step={5}
                  value={durationMin ?? ""}
                  onChange={(e) => update({ durationMin: e.target.value ? Number(e.target.value) : undefined })}
                />
                {service && service.durationMinMin !== service.durationMaxMin && (
                  <small className="muted">
                    {t.form.byService(fmtDuration(service.durationMinMin), fmtDuration(service.durationMaxMin))}
                  </small>
                )}
              </label>
              <label>
                {t.form.bufferMin}
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={5}
                  value={bufferAfterMin}
                  onChange={(e) => update({ bufferAfterMin: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
              <label>
                {t.form.price(settings.currency)}
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={price / 100}
                  onChange={(e) => update({ price: Math.round((Number(e.target.value) || 0) * 100) })}
                />
              </label>
              <label className="wide">
                {t.form.note}
                <textarea rows={2} value={draft.note} onChange={(e) => update({ note: e.target.value })} />
              </label>
            </div>
          )}
        </section>
      </main>

      {problem && <ProblemPanel problem={problem} onParallel={() => start !== undefined && save(start, true)} onClose={() => update({ time: undefined })} />}

      {!problem && hasClient && service && start !== undefined && durationMin !== undefined && (
        <footer className="savebar">
          <span>
            {fmtShortDay(draft.date)}, {fmtTime(start)}–{fmtTime(start + durationMin * MINUTE)}
          </span>
          <button className="btn primary" disabled={saving} onClick={() => save(start, false)}>
            {base ? t.common.save : t.form.book}
          </button>
        </footer>
      )}
    </div>
  );
}

function ClientStep({ draft, update, autoFocus }: { draft: Draft; update: (p: Partial<Draft>) => void; autoFocus: boolean }) {
  const [query, setQuery] = useState("");
  const clients = useClients();
  const settings = useSettings();
  const recentIds = useLiveQuery(async () => {
    const last = await db.appointments.orderBy("start").reverse().limit(300).toArray();
    return [...new Set(last.filter((a) => !a.deleted).map((a) => a.clientId))];
  }, []);
  const map = byId(clients);
  const picked = draft.clientId ? map.get(draft.clientId) : undefined;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    if (!q) return (recentIds ?? []).map((id) => map.get(id)).filter((c): c is Client => !!c).slice(0, 6);
    return (clients ?? [])
      .filter((c) => c.name.toLowerCase().includes(q) || (digits.length >= 3 && c.phone?.replace(/\D/g, "").includes(digits)))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .slice(0, 8);
  }, [query, clients, recentIds]);

  if (picked) {
    return (
      <section className="step">
        <h2>{t.form.client}</h2>
        <div className="picked">
          <span>
            <strong>{picked.name}</strong> {picked.phone && <span className="muted">{picked.phone}</span>}
          </span>
          <button className="link-btn" onClick={() => update({ clientId: undefined })}>
            {t.common.edit}
          </button>
        </div>
      </section>
    );
  }

  if (draft.newClient) {
    const nc = draft.newClient;
    return (
      <section className="step">
        <h2>{t.form.newClient}</h2>
        <div className="details">
          <label>
            {t.form.name}
            <input value={nc.name} onChange={(e) => update({ newClient: { ...nc, name: e.target.value } })} />
          </label>
          <label>
            {t.form.phone} <small className="muted">{t.common.optional}</small>
            <input
              type="tel"
              inputMode="tel"
              value={nc.phone}
              onChange={(e) => update({ newClient: { ...nc, phone: e.target.value } })}
            />
          </label>
        </div>
        <button className="link-btn" onClick={() => update({ newClient: undefined })}>
          {t.form.fromBase}
        </button>
      </section>
    );
  }

  return (
    <section className="step">
      <h2>{t.form.client}</h2>
      <input
        className="search"
        type="search"
        placeholder={t.form.searchPlaceholder}
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="options">
        {matches.map((c) => (
          <button key={c.id} className="option" onClick={() => update({ clientId: c.id })}>
            <strong>{c.name}</strong>
            {c.phone && <span className="muted">{c.phone}</span>}
          </button>
        ))}
        {query.trim() && (
          <button
            className="option add"
            onClick={() => {
              const q = query.trim();
              const isPhone = /^[+\d][\d\s()-]{5,}$/.test(q);
              update({ newClient: isPhone ? { name: "", phone: q } : { name: q, phone: "" } });
            }}
          >
            <strong>{t.form.addClient}</strong>
            <span className="muted">«{query.trim()}»</span>
          </button>
        )}
        {canPickContacts && (
          <button
            className="option add"
            onClick={async () => {
              const c = await pickContact(settings.country);
              if (!c) return;
              // Уже есть в базе с этим телефоном — берём существующего, а не создаём дубль.
              const digits = c.phone?.replace(/\D/g, "");
              const known = digits ? clients?.find((x) => x.phone?.replace(/\D/g, "") === digits) : undefined;
              update(known ? { clientId: known.id } : { newClient: { name: c.name, phone: c.phone ?? "" } });
            }}
          >
            <strong>{t.form.pickContact}</strong>
          </button>
        )}
        {!query.trim() && matches.length === 0 && !canPickContacts && <p className="hint">{t.form.searchHint}</p>}
      </div>
    </section>
  );
}

function TimeStep(props: {
  draft: Draft;
  update: (p: Partial<Draft>) => void;
  durationMin?: number;
  bufferAfterMin: number;
  excludeId?: string;
  onPickSlot: (t: number) => void;
}) {
  const { draft, update, durationMin, bufferAfterMin } = props;
  const settings = useSettings();
  const appointments = useAppointments(addDays(draft.date, -1), 3);
  const today = todayKey();
  const stripStart = draft.date < today ? draft.date : today;
  const ranges = workRangesFor(settings, draft.date);

  const slots =
    durationMin === undefined || !appointments
      ? []
      : freeSlots({
          dayStart: anchor(draft.date),
          workRanges: ranges,
          appointments: appointments.filter((a) => a.id !== props.excludeId),
          durationMin,
          bufferAfterMin,
          stepMin: SLOT_STEP_MIN,
          notBefore: Date.now(),
        });

  return (
    <section className="step">
      <h2>{t.form.time}</h2>
      <div className="date-strip">
        {Array.from({ length: DATE_STRIP_DAYS }, (_, i) => {
          const d = addDays(stripStart, i);
          return (
            <button key={d} aria-pressed={d === draft.date} className="date-chip" onClick={() => update({ date: d, time: undefined })}>
              <small>{fmtWeekday(d)}</small>
              <strong>{dayOfMonth(d)}</strong>
            </button>
          );
        })}
      </div>
      <p className="muted">{fmtDay(draft.date)}</p>

      {durationMin === undefined ? (
        <p className="hint">{t.form.pickServiceHint}</p>
      ) : ranges.length === 0 ? (
        <p className="hint">{t.form.dayOff}</p>
      ) : slots.length === 0 ? (
        <p className="hint">{t.form.noSlots(fmtDuration(durationMin))}</p>
      ) : (
        <div className="slots">
          {slots.map((t) => {
            const label = fmtTime(t);
            return (
              <button key={t} className="slot" aria-pressed={draft.time === label} onClick={() => props.onPickSlot(t)}>
                {label}
              </button>
            );
          })}
        </div>
      )}

      <label className="manual-time">
        {t.form.manualTime}
        <input
          type="time"
          step={SLOT_STEP_MIN * 60}
          value={draft.time ?? ""}
          onChange={(e) => update({ time: e.target.value || undefined })}
        />
      </label>
    </section>
  );
}

function ProblemPanel({ problem, onParallel, onClose }: { problem: Problem; onParallel: () => void; onClose: () => void }) {
  const clients = byId(useClients());
  if (problem.reason === "invalid_time") {
    return (
      <footer className="savebar problem">
        <span>{t.form.invalidTime}</span>
        <button className="btn" onClick={onClose}>
          {t.form.ok}
        </button>
      </footer>
    );
  }
  return (
    <footer className="savebar problem">
      <div>
        <strong>{t.form.conflict}</strong>
        {problem.conflicts.map((c) => (
          <div key={c.id} className="muted">
            {fmtTime(c.start)}–{fmtTime(c.end)}
            {c.bufferAfterMin > 0 && ` (+${c.bufferAfterMin} ${t.common.min})`} · {clients.get(c.clientId)?.name}
          </div>
        ))}
      </div>
      <div className="actions">
        <button className="btn primary" onClick={onClose}>
          {t.form.otherTime}
        </button>
        <button className="btn" onClick={onParallel}>
          {t.form.parallel}
        </button>
      </div>
    </footer>
  );
}
