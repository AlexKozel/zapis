import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { clientsFromTable, clientsFromVcf, dedupeClients, normalizeHandle, normalizePhone, parseCsv } from "../src/import.ts";
import { chatLink } from "../src/messages.ts";

describe("normalizePhone", () => {
  it("понимает белорусские записи номера", () => {
    for (const raw of ["+375 (29) 123-45-67", "8 029 123 45 67", "375291234567", "29 1234567", "00375291234567"]) {
      expect(normalizePhone(raw, "BY")).toBe("+375291234567");
    }
  });

  it("понимает польские записи номера", () => {
    for (const raw of ["+48 600 123 456", "600-123-456", "0048600123456"]) {
      expect(normalizePhone(raw, "PL")).toBe("+48600123456");
    }
  });

  it("не выдумывает номер из обрывка", () => {
    expect(normalizePhone("12-34", "BY")).toBe(undefined);
  });
});

describe("normalizeHandle", () => {
  it("достаёт ник из ссылки или @", () => {
    expect(normalizeHandle("@anna_hair")).toBe("anna_hair");
    expect(normalizeHandle("https://www.instagram.com/anna_hair/?igsh=x")).toBe("anna_hair");
    expect(normalizeHandle("t.me/anna")).toBe("anna");
    expect(normalizeHandle("  ")).toBe(undefined);
  });
});

describe("parseCsv", () => {
  it("разбирает CSV из Excel: точка с запятой, кавычки, переносы внутри ячейки", () => {
    const csv = '﻿Имя;Телефон;Заметка\r\nАнна;+375291234567;"7.1 + 8.0, 6%\nоксид"\r\n"Ольга ""Оля""";80447654321;\r\n';
    expect(parseCsv(csv)).toEqual([
      ["Имя", "Телефон", "Заметка"],
      ["Анна", "+375291234567", "7.1 + 8.0, 6%\nоксид"],
      ['Ольга "Оля"', "80447654321", ""],
    ]);
  });

  it("определяет запятую как разделитель", () => {
    expect(parseCsv("name,phone\nAnna,600123456")).toEqual([
      ["name", "phone"],
      ["Anna", "600123456"],
    ]);
  });
});

describe("clientsFromTable", () => {
  it("узнаёт колонки по заголовкам и приводит телефоны", () => {
    const rows = parseCsv("Фамилия;Имя;Моб. телефон;Instagram;Комментарий\nИванова;Анна;8 029 123 45 67;@anna;блонд\n;;;;");
    expect(clientsFromTable(rows, "BY")).toEqual({
      drafts: [{ name: "Анна Иванова", phone: "+375291234567", instagram: "anna", notes: "блонд" }],
      skipped: 0,
    });
  });

  it("без заголовка берёт имя и телефон из первых колонок", () => {
    const { drafts } = clientsFromTable([["Kasia", "600 123 456"]], "PL");
    expect(drafts).toEqual([{ name: "Kasia", phone: "+48600123456" }]);
  });

  it("оставляет нераспознанный телефон как есть, чтобы не потерять", () => {
    const { drafts } = clientsFromTable([["Имя", "Телефон"], ["Анна", "доб. 123"]], "BY");
    expect(drafts[0]!.phone).toBe("доб. 123");
  });
});

describe("clientsFromVcf", () => {
  it("читает контакты из vCard iPhone", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Иванова;Анна;;;",
      "FN:Анна Иванова",
      "item1.TEL;type=CELL;type=pref:+375 29 123-45-67",
      "TEL;type=HOME:+375 17 000-00-00",
      "NOTE:формула 7.1\\, оксид 6%",
      "END:VCARD",
      "BEGIN:VCARD",
      "N:Петрова;Ольга;;;",
      "TEL:8 044 765 43 21",
      "END:VCARD",
    ].join("\r\n");
    expect(clientsFromVcf(vcf, "BY")).toEqual([
      { name: "Анна Иванова", phone: "+375291234567", notes: "формула 7.1, оксид 6%" },
      { name: "Ольга Петрова", phone: "+375447654321" },
    ]);
  });
});

describe("dedupeClients", () => {
  it("пропускает тех, кто уже есть, и повторы внутри файла", () => {
    const r = dedupeClients(
      [{ name: "Анна", phone: "+375291234567" }, { name: "Аня", phone: "+375 29 123 45 67" }, { name: "Ольга" }, { name: "ольга " }, { name: "Вера" }],
      [{ name: "Анна И.", phone: "+375291234567" }],
    );
    expect(r).toEqual({ fresh: [{ name: "Ольга" }, { name: "Вера" }], duplicates: 3 });
  });
});

describe("chatLink", () => {
  it("открывает чат в Telegram по нику или номеру и в Instagram", () => {
    expect(chatLink("telegram", "@anna")).toBe("https://t.me/anna");
    expect(chatLink("telegram", "+375 29 1234567")).toBe("https://t.me/+375291234567");
    expect(chatLink("instagram", "anna_hair")).toBe("https://ig.me/m/anna_hair");
  });
});
