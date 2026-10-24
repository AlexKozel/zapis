import { useState } from "react";
import {
  clientsFromTable,
  clientsFromVcf,
  dedupeClients,
  parseCsv,
  type Client,
  type ClientDraft,
  type Country,
} from "@zapis/core";
import { db, putRows, uuid } from "../db.ts";
import { useSettings } from "../data.ts";
import { t } from "../i18n/index.ts";
import { back, go } from "../router.ts";
import { CloseButton, TopBar } from "../ui.tsx";

interface Preview {
  found: number;
  fresh: ClientDraft[];
  duplicates: number;
  skipped: number;
}

/** Excel в русской Windows сохраняет CSV в cp1251; если файл не читается как UTF-8 — пробуем её. */
function decode(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1251").decode(buf);
  }
}

async function readClients(file: File, country: Country): Promise<{ drafts: ClientDraft[]; skipped: number }> {
  const text = decode(await file.arrayBuffer());
  if (/\.vcf$/i.test(file.name) || /^\s*BEGIN:VCARD/i.test(text)) return { drafts: clientsFromVcf(text, country), skipped: 0 };
  return clientsFromTable(parseCsv(text), country);
}

export function ImportScreen() {
  const settings = useSettings();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [imported, setImported] = useState(false);

  async function pick(file: File) {
    setMessage("");
    setImported(false);
    try {
      const { drafts, skipped } = await readClients(file, settings.country);
      const { fresh, duplicates } = dedupeClients(drafts, await db.clients.toArray());
      setPreview({ found: drafts.length, fresh, duplicates, skipped });
      if (fresh.length === 0) setMessage(t.importer.nothing);
    } catch {
      setPreview(null);
      setMessage(t.importer.failed);
    }
  }

  async function run() {
    if (!preview) return;
    const now = Date.now();
    const rows: Client[] = preview.fresh.map((d) => ({ ...d, id: uuid(), updatedAt: now, reminderChannel: "none" }));
    await putRows("clients", rows);
    setPreview(null);
    setMessage(t.importer.done(rows.length));
    setImported(true);
  }

  return (
    <div className="screen">
      <TopBar title={t.importer.title} left={<CloseButton onClick={() => back({ screen: "clients" })} />} />
      <main className="content stack">
        <p>{t.importer.intro}</p>
        <p className="muted small">{t.importer.howCsv}</p>
        <p className="muted small">{t.importer.howVcf}</p>
        <label className="btn primary center">
          {t.importer.pick}
          <input
            type="file"
            accept=".csv,.vcf,.txt,text/csv,text/vcard,text/x-vcard"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
              e.target.value = "";
            }}
          />
        </label>

        {preview && (
          <section>
            <p>
              {t.importer.found(preview.found)}
              <br />
              <strong>{t.importer.fresh(preview.fresh.length)}</strong>
              <br />
              <span className="muted">{t.importer.duplicates(preview.duplicates)}</span>
              {preview.skipped > 0 && (
                <>
                  <br />
                  <span className="muted">{t.importer.skipped(preview.skipped)}</span>
                </>
              )}
            </p>
            {preview.fresh.length > 0 && (
              <>
                <h2>{t.importer.preview}</h2>
                <div className="list">
                  {preview.fresh.slice(0, 10).map((c, i) => (
                    <div key={i} className="list-row static">
                      <strong>{c.name}</strong>
                      <span className="muted small">{[c.phone, c.instagram && "@" + c.instagram, c.notes].filter(Boolean).join(" · ")}</span>
                    </div>
                  ))}
                </div>
                <button className="btn primary wide-btn" onClick={run}>
                  {t.importer.run(preview.fresh.length)}
                </button>
              </>
            )}
          </section>
        )}
        {message && (
          <p>
            {message}{" "}
            {imported && (
              <button className="link-btn" onClick={() => go({ screen: "clients" })}>
                {t.nav.clients} →
              </button>
            )}
          </p>
        )}
      </main>
    </div>
  );
}
