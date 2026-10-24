import { useLiveQuery } from "dexie-react-hooks";
import { db, DEFAULT_SETTINGS } from "./db.ts";
import { setLang } from "./i18n/index.ts";
import { tabOf, useRoute, type Route } from "./router.ts";
import { CalendarScreen } from "./screens/Calendar.tsx";
import { ClientScreen, ClientsScreen } from "./screens/Clients.tsx";
import { ImportScreen } from "./screens/Import.tsx";
import { EditAppointmentScreen, NewAppointmentScreen } from "./screens/NewAppointment.tsx";
import { ServiceScreen, ServicesScreen } from "./screens/Services.tsx";
import { SettingsScreen } from "./screens/Settings.tsx";
import { OfflineBanner, TabBar } from "./ui.tsx";

export function App() {
  const route = useRoute();
  // Ждём настройки, чтобы не мигнуть экраном на языке по умолчанию.
  const settings = useLiveQuery(() => db.settings.get("main"), [], null);
  if (settings === null) return null;
  const lang = settings?.lang ?? DEFAULT_SETTINGS.lang;
  setLang(lang);
  const tab = tabOf(route);

  return (
    <div key={lang} className={tab ? "with-tabs" : undefined}>
      <OfflineBanner />
      <Screen route={route} />
      {tab && <TabBar active={tab} />}
    </div>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route.screen) {
    case "day":
      return <CalendarScreen view="day" date={route.date} saved={route.saved} />;
    case "week":
    case "month":
      return <CalendarScreen view={route.screen} date={route.date} />;
    case "new":
      return (
        <NewAppointmentScreen
          key={`${route.date}-${route.time}-${route.client}`}
          date={route.date}
          time={route.time}
          client={route.client}
        />
      );
    case "edit":
      return <EditAppointmentScreen key={route.id} id={route.id} />;
    case "clients":
      return <ClientsScreen />;
    case "client":
      return <ClientScreen key={route.id} id={route.id} />;
    case "import":
      return <ImportScreen />;
    case "services":
      return <ServicesScreen />;
    case "service":
      return <ServiceScreen key={route.id} id={route.id} />;
    case "settings":
      return <SettingsScreen />;
  }
}
