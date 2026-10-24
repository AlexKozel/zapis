import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Service } from "@zapis/core";
import { db, saveRow, uuid } from "../db.ts";
import { useServices, useSettings } from "../data.ts";
import { t } from "../i18n/index.ts";
import { back, go } from "../router.ts";
import { fmtDuration, fmtMoney } from "../time.ts";
import { CloseButton, TopBar } from "../ui.tsx";

function rangeText(from: string, to: string): string {
  return from === to ? from : `${from} – ${to}`;
}

export function ServicesScreen() {
  const services = useServices();
  const settings = useSettings();
  return (
    <div className="screen">
      <TopBar title={t.services.title} />
      <main className="content">
        <div className="toolbar">
          <button className="btn primary" onClick={() => go({ screen: "service", id: "new" })}>
            {t.services.add}
          </button>
        </div>
        <div className="list">
          {services?.map((s) => (
            <button key={s.id} className="list-row" onClick={() => go({ screen: "service", id: s.id })}>
              <strong>
                {s.name} {s.isConsultation && <span className="tag">{t.services.consultation}</span>}
              </strong>
              <span className="muted small">
                {rangeText(fmtDuration(s.durationMinMin), fmtDuration(s.durationMaxMin))}
                {s.bufferAfterMin > 0 && ` (${t.services.buffer(s.bufferAfterMin)})`}
                {s.priceMax > 0 &&
                  " · " + rangeText(fmtMoney(s.priceMin, settings.currency), fmtMoney(s.priceMax, settings.currency))}
              </span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}

export function ServiceScreen({ id }: { id: string }) {
  const service = useLiveQuery(() => (id === "new" ? undefined : db.services.get(id)), [id], null);
  if (id === "new") return <ServiceForm />;
  if (service === null) return null;
  if (!service || service.deleted) return <p className="hint">{t.services.notFound}</p>;
  return <ServiceForm service={service} />;
}

function ServiceForm({ service }: { service?: Service }) {
  const settings = useSettings();
  // Цены в форме — в рублях/злотых, в базе — в копейках/грошах.
  const [form, setForm] = useState({
    name: service?.name ?? "",
    durationMinMin: service?.durationMinMin ?? 60,
    durationMaxMin: service?.durationMaxMin ?? 60,
    bufferAfterMin: service?.bufferAfterMin ?? 15,
    priceMin: (service?.priceMin ?? 0) / 100,
    priceMax: (service?.priceMax ?? 0) / 100,
    isConsultation: service?.isConsultation ?? false,
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const valid =
    form.name.trim() !== "" &&
    form.durationMinMin > 0 &&
    form.durationMaxMin >= form.durationMinMin &&
    form.priceMax >= form.priceMin &&
    form.bufferAfterMin >= 0;
  const close = () => back({ screen: "services" });

  async function save() {
    if (!valid) return;
    await saveRow("services", {
      ...service,
      id: service?.id ?? uuid(),
      name: form.name.trim(),
      durationMinMin: form.durationMinMin,
      durationMaxMin: form.durationMaxMin,
      bufferAfterMin: form.bufferAfterMin,
      priceMin: Math.round(form.priceMin * 100),
      priceMax: Math.round(form.priceMax * 100),
      isConsultation: form.isConsultation || undefined,
    });
    close();
  }

  async function remove() {
    if (!service || !confirm(t.services.deleteConfirm)) return;
    await saveRow("services", { ...service, deleted: true });
    close();
  }

  const num = (v: string) => Math.max(0, Number(v.replace(",", ".")) || 0);

  return (
    <div className="screen">
      <TopBar
        title={service ? t.services.titleEdit : t.services.titleNew}
        left={<CloseButton onClick={close} />}
        right={
          <button className="link-btn" disabled={!valid} onClick={save}>
            {t.common.save}
          </button>
        }
      />
      <main className="content">
        <div className="fields two">
          <label className="wide">
            {t.services.name}
            <input value={form.name} autoFocus={!service} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label>
            {t.services.durationFrom}
            <input
              type="number"
              inputMode="numeric"
              step={15}
              value={form.durationMinMin}
              onChange={(e) => {
                const v = num(e.target.value);
                // Пока «до» не трогали, оно следует за «от»: у большинства услуг длительность фиксированная.
                set({ durationMinMin: v, durationMaxMin: form.durationMaxMin === form.durationMinMin ? v : Math.max(v, form.durationMaxMin) });
              }}
            />
          </label>
          <label>
            {t.services.durationTo}
            <input
              type="number"
              inputMode="numeric"
              step={15}
              value={form.durationMaxMin}
              onChange={(e) => set({ durationMaxMin: num(e.target.value) })}
            />
          </label>
          <label>
            {t.services.priceFrom(settings.currency)}
            <input
              type="number"
              inputMode="decimal"
              value={form.priceMin}
              onChange={(e) => {
                const v = num(e.target.value);
                set({ priceMin: v, priceMax: form.priceMax === form.priceMin ? v : Math.max(v, form.priceMax) });
              }}
            />
          </label>
          <label>
            {t.services.priceTo}
            <input type="number" inputMode="decimal" value={form.priceMax} onChange={(e) => set({ priceMax: num(e.target.value) })} />
          </label>
          <label>
            {t.services.bufferMin}
            <input
              type="number"
              inputMode="numeric"
              step={5}
              value={form.bufferAfterMin}
              onChange={(e) => set({ bufferAfterMin: num(e.target.value) })}
            />
          </label>
          <label className="check wide">
            <input type="checkbox" checked={form.isConsultation} onChange={(e) => set({ isConsultation: e.target.checked })} />
            {t.services.isConsultation}
          </label>
        </div>
        {!valid && form.name.trim() !== "" && <p className="hint">{t.services.invalid}</p>}
        {service && (
          <button className="btn danger wide-btn" onClick={remove}>
            {t.common.delete}
          </button>
        )}
      </main>
    </div>
  );
}
