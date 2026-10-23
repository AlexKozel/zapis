import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { applyDelay, checkBooking, freeSlots, freeWindows, MINUTE, parseHm } from "../src/calendar.ts";
import type { Appointment } from "../src/types.ts";

const DAY = Date.UTC(2026, 10, 2); // условная «полночь» дня
const at = (hm: string) => DAY + parseHm(hm) * MINUTE;

function appt(id: string, from: string, to: string, extra: Partial<Appointment> = {}): Appointment {
  return {
    id,
    clientId: "c-" + id,
    serviceId: "s1",
    start: at(from),
    end: at(to),
    bufferAfterMin: 0,
    price: 10000,
    status: "scheduled",
    parallel: false,
    updatedAt: 1,
    ...extra,
  };
}

describe("checkBooking", () => {
  const day = [appt("a", "10:00", "13:00", { bufferAfterMin: 15 }), appt("b", "15:00", "16:00")];

  it("пропускает запись в свободное время", () => {
    const r = checkBooking(day, { start: at("13:15"), end: at("14:45"), bufferAfterMin: 0 });
    expect(r).toMatchObject({ ok: true, parallel: false });
  });

  it("учитывает запас после предыдущей записи", () => {
    const r = checkBooking(day, { start: at("13:00"), end: at("14:00"), bufferAfterMin: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "conflict") expect(r.conflicts.map((c) => c.id)).toEqual(["a"]);
  });

  it("учитывает собственный запас кандидата", () => {
    const r = checkBooking(day, { start: at("14:00"), end: at("14:50"), bufferAfterMin: 15 });
    expect(r.ok).toBe(false);
  });

  it("разрешает накладку, если мастер выбрал «параллельно»", () => {
    const r = checkBooking(day, { start: at("11:00"), end: at("11:30"), bufferAfterMin: 0 }, { allowParallel: true });
    expect(r).toMatchObject({ ok: true, parallel: true });
    if (r.ok) expect(r.conflicts).toHaveLength(1);
  });

  it("не считает отменённые записи и не-явки", () => {
    const withCancelled = [...day, appt("x", "17:00", "18:00", { status: "cancelled" }), appt("y", "18:00", "19:00", { status: "no_show" })];
    const r = checkBooking(withCancelled, { start: at("17:00"), end: at("19:00"), bufferAfterMin: 0 });
    expect(r.ok).toBe(true);
  });

  it("при редактировании не конфликтует сама с собой", () => {
    const r = checkBooking(day, { id: "b", start: at("15:30"), end: at("16:30"), bufferAfterMin: 0 });
    expect(r.ok).toBe(true);
  });

  it("отклоняет запись, которая заканчивается раньше начала", () => {
    const r = checkBooking(day, { start: at("12:00"), end: at("11:00"), bufferAfterMin: 0 });
    expect(r).toEqual({ ok: false, reason: "invalid_time" });
  });
});

describe("freeSlots", () => {
  it("находит окна для длинного окрашивания с учётом запаса", () => {
    const slots = freeSlots({
      dayStart: DAY,
      workRanges: [{ from: "09:00", to: "19:00" }],
      appointments: [appt("a", "10:00", "13:00", { bufferAfterMin: 15 })],
      durationMin: 240,
      bufferAfterMin: 15,
      stepMin: 30,
    });
    // До 10:00 4 часа не помещаются; после 13:15 сетка 30 мин даёт 13:30 и позже, до 15:00 (конец в 19:00).
    expect(slots.map((s) => (s - DAY) / MINUTE / 60)).toEqual([13.5, 14, 14.5, 15]);
  });

  it("не предлагает прошедшее время", () => {
    const slots = freeSlots({
      dayStart: DAY,
      workRanges: [{ from: "09:00", to: "11:00" }],
      appointments: [],
      durationMin: 60,
      bufferAfterMin: 0,
      stepMin: 30,
      notBefore: at("09:40"),
    });
    expect(slots).toEqual([at("10:00")]);
  });

  it("работает с несколькими рабочими интервалами (перерыв на обед)", () => {
    const slots = freeSlots({
      dayStart: DAY,
      workRanges: [
        { from: "09:00", to: "12:00" },
        { from: "13:00", to: "15:00" },
      ],
      appointments: [],
      durationMin: 120,
      bufferAfterMin: 0,
      stepMin: 60,
    });
    expect(slots).toEqual([at("09:00"), at("10:00"), at("13:00")]);
  });
});

describe("freeWindows", () => {
  const span = (w: { start: number; end: number }) => [(w.start - DAY) / MINUTE / 60, (w.end - DAY) / MINUTE / 60];

  it("находит промежутки между записями с учётом запаса и перерыва", () => {
    const windows = freeWindows({
      dayStart: DAY,
      workRanges: [
        { from: "09:00", to: "13:00" },
        { from: "14:00", to: "19:00" },
      ],
      appointments: [
        appt("a", "10:00", "12:00", { bufferAfterMin: 15 }),
        appt("p", "11:00", "12:30", { parallel: true }),
        appt("b", "15:00", "16:00"),
        appt("x", "17:00", "18:00", { status: "cancelled" }),
      ],
    });
    expect(windows.map(span)).toEqual([
      [9, 10],
      [12.5, 13],
      [14, 15],
      [16, 19],
    ]);
  });

  it("отбрасывает короткие окна и прошедшее время", () => {
    const windows = freeWindows({
      dayStart: DAY,
      workRanges: [{ from: "09:00", to: "19:00" }],
      appointments: [appt("a", "10:00", "13:00"), appt("b", "13:20", "15:00")],
      minMin: 30,
      notBefore: at("09:30"),
    });
    expect(windows.map(span)).toEqual([
      [9.5, 10],
      [15, 19],
    ]);
  });
});

describe("applyDelay", () => {
  it("сдвигает следующие записи по цепочке, пока есть пересечение", () => {
    const day = [
      appt("a", "10:00", "13:00"),
      appt("b", "13:00", "14:00"),
      appt("c", "14:00", "15:00"),
      appt("d", "17:00", "18:00"),
    ];
    const shifts = applyDelay(day, "a", 45);
    expect(shifts.map((s) => s.appointment.id)).toEqual(["b", "c"]);
    expect(shifts[0]!.newStart).toBe(at("13:45"));
    expect(shifts[1]!.newStart).toBe(at("14:45"));
  });

  it("не трогает записи, если задержку поглощает свободное время", () => {
    const day = [appt("a", "10:00", "13:00"), appt("b", "14:00", "15:00")];
    expect(applyDelay(day, "a", 30)).toEqual([]);
  });

  it("не сдвигает сознательно параллельные записи", () => {
    const day = [appt("a", "10:00", "13:00"), appt("p", "12:00", "12:30", { parallel: true }), appt("b", "13:00", "14:00")];
    expect(applyDelay(day, "a", 30).map((s) => s.appointment.id)).toEqual(["b"]);
  });
});
