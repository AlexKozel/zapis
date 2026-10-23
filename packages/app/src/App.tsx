import { useRoute } from "./router.ts";
import { CalendarScreen } from "./screens/Calendar.tsx";
import { EditAppointmentScreen, NewAppointmentScreen } from "./screens/NewAppointment.tsx";

export function App() {
  const route = useRoute();
  switch (route.screen) {
    case "day":
      return <CalendarScreen view="day" date={route.date} saved={route.saved} />;
    case "week":
      return <CalendarScreen view="week" date={route.date} />;
    case "new":
      return <NewAppointmentScreen key={`${route.date}-${route.time}`} date={route.date} time={route.time} />;
    case "edit":
      return <EditAppointmentScreen key={route.id} id={route.id} />;
  }
}
