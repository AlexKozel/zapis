import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { clientStats, incomeSummary } from "../src/stats.ts";
import { mergeById } from "../src/sync.ts";
import { delayText, reminderText, shareLink } from "../src/messages.ts";
import type { Appointment, Client } from "../src/types.ts";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 10);

function visit(id: string, dayOffset: number, price: number, status: Appointment["status"] = "done"): Appointment {
  return {
    id,
    clientId: "anna",
    serviceId: "s",
    start: T0 + dayOffset * DAY,
    end: T0 + dayOffset * DAY + 3_600_000,
    bufferAfterMin: 0,
    price,
    status,
    parallel: false,
    updatedAt: 1,
  };
}

describe("clientStats", () => {
  it("считает визиты, сумму, частоту и следующий визит", () => {
    const appts = [visit("1", 0, 15000), visit("2", 42, 18000), visit("3", 84, 18000), visit("4", 126, 20000, "scheduled"), visit("5", 50, 5000, "cancelled")];
    const s = clientStats(appts, "anna", T0 + 100 * DAY);
    expect(s).toEqual({
      visits: 3,
      total: 51000,
      lastVisit: T0 + 84 * DAY,
      nextVisit: T0 + 126 * DAY,
      avgIntervalDays: 42,
    });
  });
});

describe("incomeSummary", () => {
  it("считает доход только по состоявшимся визитам", () => {
    const appts = [visit("1", 0, 15000), visit("2", 1, 9000), visit("3", 2, 7000, "no_show"), visit("4", 3, 7000, "cancelled"), visit("5", 40, 99999)];
    expect(incomeSummary(appts, T0, T0 + 30 * DAY)).toEqual({ visits: 2, income: 24000, noShows: 1, cancelled: 1 });
  });
});

describe("mergeById", () => {
  const c = (id: string, name: string, updatedAt: number): Client => ({ id, name, updatedAt, reminderChannel: "viber" });

  it("побеждает последнее изменение, затёртая версия сохраняется", () => {
    const local = [c("1", "Анна (телефон)", 200), c("2", "Ольга", 100)];
    const remote = [c("1", "Анна (сервер)", 150), c("2", "Ольга новая", 300), c("3", "Ира", 50)];
    const { merged, overwritten } = mergeById(local, remote);
    const names = Object.fromEntries(merged.map((x) => [x.id, x.name]));
    expect(names).toEqual({ "1": "Анна (телефон)", "2": "Ольга новая", "3": "Ира" });
    expect(overwritten.map((x) => x.name).sort()).toEqual(["Анна (сервер)", "Ольга"]);
  });
});

describe("messages", () => {
  const start = Date.UTC(2026, 10, 3, 12, 30); // 15:30 в Минске (UTC+3)

  it("пишет напоминание в часовом поясе мастера", () => {
    const t = reminderText({ lang: "ru", clientName: "Анна", masterName: "Кристине", start, timeZone: "Europe/Minsk" });
    expect(t).toContain("15:30");
    expect(t).toContain("ноября");
  });

  it("пишет сообщение о задержке по-польски", () => {
    expect(delayText({ lang: "pl", clientName: "Ola", newStart: start, timeZone: "Europe/Warsaw" })).toContain("13:30");
  });

  it("собирает ссылки для SMS и Viber", () => {
    expect(shareLink("sms", "+375 29 000-00-00", "Привет")).toBe("sms:+375290000000?body=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82");
    expect(shareLink("viber", "+375 29 000-00-00", "x")).toBe("viber://chat?number=%2B375290000000");
  });
});
