import { useAppStore } from '../../store';

/** Siguiente paso cuando no hay datos: conectar un cargador real o usar el emulador. */
export const EmptyHelp = ({ text }: { text: string }) => {
  const setView = useAppStore((s) => s.setView);
  return (
    <>
      <p className="muted">{text}</p>
      <p className="muted mono">
        Cargador real: ws://{location.hostname}:3000/ocpp/&#123;id&#125; · subprotocolo ocpp1.6 / ocpp2.0.1 / ocpp2.1
      </p>
      <button className="btn btn--primary" onClick={() => setView('emulator')}>
        Abrir el emulador
      </button>
    </>
  );
};
