import { useAppStore } from '../../store';
import type { View } from '../../store/slices/uiSlice';
import { Icon, type IconName } from '../ui/Icon';

const NAV: { view: View; label: string; icon: IconName }[] = [
  { view: 'session', label: 'Sesión', icon: 'session' },
  { view: 'chargers', label: 'Cargadores', icon: 'charger' },
  { view: 'history', label: 'Historial', icon: 'history' },
  { view: 'profiles', label: 'Perfiles', icon: 'trend' },
  { view: 'emulator', label: 'Emulador', icon: 'plug' },
];

export const Sidebar = () => {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);

  const item = (n: (typeof NAV)[number] | { view: View; label: string; icon: IconName }) => (
    <button
      key={n.view}
      className={`nav__item ${view === n.view ? 'is-active' : ''}`}
      onClick={() => setView(n.view)}
      aria-current={view === n.view ? 'page' : undefined}
    >
      <Icon name={n.icon} />
      <span>{n.label}</span>
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar__logo" aria-label="EV Platform">
        <Icon name="bolt" size={20} />
      </div>
      <nav className="nav">{NAV.map(item)}</nav>
      <div className="sidebar__bottom">
        {item({ view: 'settings', label: 'Ajustes', icon: 'sliders' })}
      </div>
    </aside>
  );
};
