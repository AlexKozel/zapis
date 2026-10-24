import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  chatLink,
  clientStats,
  normalizeHandle,
  normalizePhone,
  type Client,
  type ReminderChannel,
} from "@zapis/core";
import { db, saveRow, uuid } from "../db.ts";
import { byId, useClientAppointments, useClients, useServices, useSettings } from "../data.ts";
import { t } from "../i18n/index.ts";
import { back, go } from "../router.ts";
import { fmtDate, fmtMoney, fmtShortDay, fmtTime, dayKey, todayKey } from "../time.ts";
import { CloseButton, TopBar } from "../ui.tsx";

const CHANNELS: ReminderChannel[] = ["telegram", "instagram", "viber", "sms", "whatsapp", "none"];

/** Позвонить и открыть переписку — мастер обычно пишет клиентам в Telegram и Instagram. */
export function ContactLinks({ client }: { client: Client }) {
  if (!client.phone && !client.telegram && !client.instagram) return null;
  return (
    <div className="contacts">
      {client.phone && <a href={`tel:${client.phone}`}>{client.phone}</a>}
      {client.telegram && (
        <a href={chatLink("telegram", client.telegram)} target="_blank" rel="noreferrer">
          Telegram
        </a>
      )}
      {client.instagram && (
        <a href={chatLink("instagram", client.instagram)} target="_blank" rel="noreferrer">
          Instagram
        </a>
      )}
    </div>
  );
}

function matches(c: Client, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  return (
    c.name.toLowerCase().includes(q) ||
    (digits.length >= 3 && !!c.phone?.replace(/\D/g, "").includes(digits)) ||
    !!c.telegram?.toLowerCase().includes(q.replace(/^@/, "")) ||
    !!c.instagram?.toLowerCase().includes(q.replace(/^@/, ""))
  );
}

export function ClientsScreen() {
  const clients = useClients();
  const [query, setQuery] = useState("");
  // Последний визит каждого клиента — для подписи в списке.
  const lastVisit = useLiveQuery(async () => {
    const map = new Map<string, number>();
    await db.appointments.each((a) => {
      if (!a.deleted && a.status === "done" && a.start > (map.get(a.clientId) ?? 0)) map.set(a.clientId, a.start);
    });
    return map;
  }, []);

  const list = useMemo(
    () => (clients ?? []).filter((c) => matches(c, query)).sort((a, b) => a.name.localeCompare(b.name)),
    [clients, query],
  );

  return (
    <div className="screen">
      <TopBar title={t.clients.title} />
      <main className="content">
        <div className="toolbar">
          <button className="btn primary" onClick={() => go({ screen: "client", id: "new" })}>
            {t.clients.add}
          </button>
          <button className="btn" onClick={() => go({ screen: "import" })}>
            {t.clients.import}
          </button>
        </div>
        {clients && clients.length === 0 ? (
          <p className="hint">{t.clients.empty}</p>
        ) : (
          <>
            <input
              className="search"
              type="search"
              placeholder={t.clients.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <p className="muted small">{t.clients.count(list.length)}</p>
            <div className="list">
              {list.map((c) => {
                const last = lastVisit?.get(c.id);
                return (
                  <button key={c.id} className="list-row" onClick={() => go({ screen: "client", id: c.id })}>
                    <strong>{c.name}</strong>
                    <span className="muted small">
                      {[c.phone, c.instagram && "@" + c.instagram, last ? t.clients.lastVisit(fmtDate(last)) : t.clients.noVisits]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export function ClientScreen({ id }: { id: string }) {
  const client = useLiveQuery(() => (id === "new" ? undefined : db.clients.get(id)), [id], null);
  const [editing, setEditing] = useState(false);
  if (id === "new") return <ClientForm />;
  if (client === null) return null;
  if (!client || client.deleted) return <p className="hint">{t.clients.notFound}</p>;
  if (editing) return <ClientForm client={client} onDone={() => setEditing(false)} />;
  return <ClientCard client={client} onEdit={() => setEditing(true)} />;
}

function ClientCard({ client, onEdit }: { client: Client; onEdit: () => void }) {
  const appointments = useClientAppointments(client.id);
  const services = byId(useServices());
  const settings = useSettings();
  const stats = clientStats(appointments ?? [], client.id, Date.now());

  return (
    <div className="screen">
      <TopBar
        title={client.name}
        left={<CloseButton onClick={() => back({ screen: "clients" })} />}
        right={
          <button className="link-btn" onClick={onEdit}>
            {t.common.edit}
          </button>
        }
      />
      <main className="content stack">
        <ContactLinks client={client} />
        {client.reminderChannel !== "none" && (
          <p className="muted small">{t.clients.remindVia(t.channels[client.reminderChannel])}</p>
        )}

        <div className="stats">
          <div>
            <span className="muted small">{t.clients.visits}</span>
            <strong>{stats.visits}</strong>
          </div>
          <div>
            <span className="muted small">{t.clients.total}</span>
            <strong>{fmtMoney(stats.total, settings.currency)}</strong>
          </div>
          {stats.avgIntervalDays !== undefined && (
            <div>
              <span className="muted small">{t.clients.frequency}</span>
              <strong>{t.clients.every(stats.avgIntervalDays)}</strong>
            </div>
          )}
          {stats.nextVisit !== undefined && (
            <div>
              <span className="muted small">{t.clients.next}</span>
              <strong>
                {fmtShortDay(dayKey(stats.nextVisit))}, {fmtTime(stats.nextVisit)}
              </strong>
            </div>
          )}
        </div>

        {client.notes && (
          <section>
            <h2>{t.clients.notes}</h2>
            <p className="note">{client.notes}</p>
          </section>
        )}

        <button className="btn primary" onClick={() => go({ screen: "new", date: todayKey(), client: client.id })}>
          {t.clients.book}
        </button>

        <section>
          <h2>{t.clients.history}</h2>
          {appointments && appointments.length === 0 && <p className="hint">{t.clients.noHistory}</p>}
          {appointments?.map((a) => (
            <button key={a.id} className="row" onClick={() => go({ screen: "day", date: dayKey(a.start) })}>
              <span>{fmtDate(a.start)}</span>
              <span className="grow">{services.get(a.serviceId)?.name}</span>
              <span className={a.status === "done" ? "" : "muted"}>
                {a.status === "done" ? fmtMoney(a.price, settings.currency) : t.status[a.status]}
              </span>
            </button>
          ))}
        </section>
      </main>
    </div>
  );
}

function ClientForm({ client, onDone }: { client?: Client; onDone?: () => void }) {
  const settings = useSettings();
  const [form, setForm] = useState({
    name: client?.name ?? "",
    phone: client?.phone ?? "",
    telegram: client?.telegram ?? "",
    instagram: client?.instagram ?? "",
    reminderChannel: client?.reminderChannel ?? ("none" as ReminderChannel),
    source: client?.source ?? "",
    notes: client?.notes ?? "",
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const close = () => (onDone ? onDone() : back({ screen: "clients" }));

  async function save() {
    const phone = form.phone.trim();
    const saved = await saveRow("clients", {
      ...client,
      id: client?.id ?? uuid(),
      name: form.name.trim(),
      phone: phone ? (normalizePhone(phone, settings.country) ?? phone) : undefined,
      telegram: normalizeHandle(form.telegram),
      instagram: normalizeHandle(form.instagram),
      reminderChannel: form.reminderChannel,
      source: form.source.trim() || undefined,
      notes: form.notes.trim() || undefined,
    });
    if (client) close();
    else go({ screen: "client", id: saved.id }, { replace: true });
  }

  async function remove() {
    if (!client || !confirm(t.clients.deleteConfirm)) return;
    await saveRow("clients", { ...client, deleted: true });
    go({ screen: "clients" }, { replace: true });
  }

  return (
    <div className="screen">
      <TopBar
        title={client ? t.clients.titleEdit : t.clients.titleNew}
        left={<CloseButton onClick={close} />}
        right={
          <button className="link-btn" disabled={!form.name.trim()} onClick={save}>
            {t.common.save}
          </button>
        }
      />
      <main className="content">
        <div className="fields">
          <label>
            {t.clients.name}
            <input value={form.name} autoFocus={!client} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label>
            {t.clients.phone}
            <input type="tel" inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          </label>
          <label>
            {t.clients.telegram}
            <input autoCapitalize="off" value={form.telegram} onChange={(e) => set({ telegram: e.target.value })} />
          </label>
          <label>
            {t.clients.instagram}
            <input autoCapitalize="off" value={form.instagram} onChange={(e) => set({ instagram: e.target.value })} />
          </label>
          <label>
            {t.clients.channel}
            <select
              value={form.reminderChannel}
              onChange={(e) => set({ reminderChannel: e.target.value as ReminderChannel })}
            >
              {CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {t.channels[ch]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.clients.source}
            <input value={form.source} onChange={(e) => set({ source: e.target.value })} />
          </label>
          <label>
            {t.clients.notesHint}
            <textarea rows={4} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </label>
        </div>
        {client && (
          <button className="btn danger wide-btn" onClick={remove}>
            {t.common.delete}
          </button>
        )}
      </main>
    </div>
  );
}
