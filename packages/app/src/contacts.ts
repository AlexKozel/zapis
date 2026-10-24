import { clientToVcf, normalizePhone, type Client, type Country } from "@zapis/core";

/**
 * Телефонная книга. Записать контакт сайт не может нигде — отдаём системе vCard, она предлагает его сохранить.
 * Выбрать контакт из книги умеет только Chrome на Android (Contact Picker API); на iPhone кнопки просто нет.
 */

interface ContactsManager {
  select(props: ("name" | "tel")[], opts?: { multiple?: boolean }): Promise<{ name?: string[]; tel?: string[] }[]>;
}

export const canPickContacts = "contacts" in navigator && "ContactsManager" in window;

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export async function pickContact(country: Country): Promise<{ name: string; phone?: string } | null> {
  const contacts = (navigator as unknown as { contacts: ContactsManager }).contacts;
  const [c] = await contacts.select(["name", "tel"], { multiple: false });
  if (!c) return null;
  const raw = c.tel?.[0]?.trim();
  const phone = raw ? (normalizePhone(raw, country) ?? raw) : undefined;
  const name = c.name?.[0]?.trim() || phone;
  return name ? { name, phone } : null;
}

export async function saveToPhoneContacts(client: Pick<Client, "name" | "phone" | "telegram" | "instagram" | "notes">) {
  const file = new File([clientToVcf(client)], `${client.name}.vcf`, { type: "text/vcard" });
  if (isIOS) {
    // iPhone, открыв vCard, сам показывает карточку с кнопкой «Создать новый контакт».
    const url = URL.createObjectURL(file);
    if (!window.open(url, "_blank")) location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  try {
    // Android: «Поделиться» → «Контакты».
    if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file] });
  } catch {
    return; // мастер закрыл окно «Поделиться»
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(a.href);
}
