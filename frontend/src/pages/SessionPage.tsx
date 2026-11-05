import { EmptyHelp } from '../components/ui/EmptyHelp';
import { AuthBanner } from '../components/session/AuthBanner';
import { BatteryCard } from '../components/session/BatteryCard';
import { ChargerInfoCard } from '../components/session/ChargerInfoCard';
import { ChargingStage } from '../components/session/ChargingStage';
import { EventsCard } from '../components/session/EventsCard';
import { OnlineCard } from '../components/session/OnlineCard';
import { PowerCard } from '../components/session/PowerCard';
import { TemperatureCard } from '../components/session/TemperatureCard';
import { TransactionBar } from '../components/session/TransactionBar';
import { EmptyState } from '../components/ui/Card';
import { useSelectedChargePoint, useSessionView } from '../store/selectors';

export const SessionPage = () => {
  const cp = useSelectedChargePoint();
  const view = useSessionView();

  if (!cp) {
    return (
      <EmptyState title="Esperando cargadores">
        <EmptyHelp text="Conecta un cargador por OCPP 1.6J / 2.0.1 / 2.1 o MQTT, o prueba sin hardware con el emulador." />
      </EmptyState>
    );
  }

  return (
    <div className="session">
      <div className="col col--left">
        <PowerCard view={view} />
        <BatteryCard view={view} />
        <TemperatureCard view={view} />
      </div>
      <div className="col col--center">
        <AuthBanner view={view} />
        <ChargingStage view={view} />
        <TransactionBar view={view} />
      </div>
      <div className="col col--right">
        <ChargerInfoCard />
        <EventsCard />
        <OnlineCard />
      </div>
    </div>
  );
};
