import { useEffect } from 'react';
import { connectLiveSocket } from './api/liveSocket';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { ChargersPage } from './pages/ChargersPage';
import { ProfilesPage } from './pages/ProfilesPage';
import { EmulatorPage } from './pages/EmulatorPage';
import { HistoryPage } from './pages/HistoryPage';
import { SessionPage } from './pages/SessionPage';
import { SettingsPage } from './pages/SettingsPage';
import { useAppStore } from './store';
import { bindHashNavigation } from './store/slices/uiSlice';

const PAGES = {
  session: SessionPage,
  chargers: ChargersPage,
  history: HistoryPage,
  profiles: ProfilesPage,
  emulator: EmulatorPage,
  settings: SettingsPage,
} as const;

export const App = () => {
  const view = useAppStore((s) => s.view);

  // Conexión en vivo: en cada (re)conexión se resincroniza por REST y luego se aplican eventos.
  useEffect(() => bindHashNavigation((v) => useAppStore.getState().setView(v)), []);

  useEffect(() => {
    const { applyLiveEvent, setLiveStatus } = useAppStore.getState();
    return connectLiveSocket({
      onEvent: applyLiveEvent,
      onStatus: setLiveStatus,
      onOpen: () => {
        const s = useAppStore.getState();
        void s
          .loadChargePoints()
          .then(() => {
            const id = useAppStore.getState().selectedId;
            if (id) return useAppStore.getState().loadSnapshot(id);
          })
          .catch(() => undefined);
      },
    });
  }, []);

  const Page = PAGES[view];

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <TopBar />
        <Page />
      </main>
    </div>
  );
};
