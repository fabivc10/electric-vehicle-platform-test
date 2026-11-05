# AGENTS.md — EV Charging Platform (CSMS + Dashboard)

Guía para agentes de IA y personas que trabajen en este repo. Léela completa antes de cambiar código.

## Qué es

Un **CSMS** (Charging Station Management System) que recibe cargadores de vehículos eléctricos y un **dashboard** en tiempo real.

- Los cargadores se conectan por **OCPP 1.6J**, **OCPP 2.0.1**, **OCPP 2.1** (WebSocket) o **MQTT**.
- El backend normaliza todo a un **modelo de dominio único** (`shared/src/index.ts`) y lo empuja al dashboard por WebSocket.
- El dashboard muestra la sesión de carga: potencia, SoC, energía, V/A, temperatura, autorización, transacción, heartbeat y log de eventos OCPP. Permite comandos remotos (iniciar/detener carga, reset, trigger, unlock).
- La sección **Emulador** del dashboard es un cargador OCPP (1.6J / 2.0.1 / 2.1) que corre en el navegador y se conecta a `/ocpp/{id}` como un equipo físico. Lo físico (cable, tarjeta, medidor, fallas) se controla a mano; **qué mensajes salen, con qué campos y cuándo lo decide la especificación y su configuración OCPP** (claves Core §9.1 en 1.6, Device Model en 2.x), que el CSMS lee/cambia desde Ajustes.

> Nota: **"OCPP 2.2" no existe**. Las versiones vigentes son 1.6, 2.0.1 y 2.1 (2025). Si se publica una versión nueva, se agrega como otra estrategia (ver "Agregar una versión de OCPP").

## Stack

| Parte | Tecnología |
|---|---|
| Monorepo | npm workspaces: `shared/`, `backend/`, `frontend/` |
| Backend | Node ≥ 22, TypeScript (ESM, `NodeNext`), **Express 5**, `ws`, `mqtt`, `zod` |
| Frontend | **React 19**, **Zustand 5**, Vite, TypeScript, CSS plano con tokens (sin framework de UI), **three.js** (escena 3D del vehículo) |
| Persistencia | **En memoria** detrás de interfaces Repository. **No se usa MongoDB.** |

## Comandos

```bash
npm install                 # en la raíz (instala los 3 workspaces)
npm run dev                 # backend :3000 + frontend :5173 (proxy /api, /live y /ocpp → :3000)
npm run simulate            # cargador 1.6 por CLI con sesión automática (CP-001). Para pruebas manuales usa la sección Emulador
npm run typecheck           # tsc en backend y frontend — debe quedar en 0 errores
npm run build
```

Configuración del backend: copiar `backend/.env.example` a `backend/.env`. `LOG_LEVEL=debug` imprime cada frame OCPP.

## Endpoints

| Tipo | Ruta | Uso |
|---|---|---|
| WS | `ws://host:3000/ocpp/{chargePointId}` | Cargadores OCPP. Subprotocolo por `Sec-WebSocket-Protocol`: `ocpp1.6`, `ocpp2.0.1`, `ocpp2.1`. Sin header → `OCPP_DEFAULT_PROTOCOL`. Subprotocolo desconocido → HTTP 400. |
| WS | `ws://host:3000/live` | Dashboard. Recibe `LiveEvent` (JSON). |
| GET | `/api/health` | Estado y cargadores conectados |
| GET | `/api/charge-points` | Lista de `ChargePoint` |
| GET | `/api/charge-points/:id` | `ChargePointSnapshot` (cp, transacciones activas, medidas, actividad) |
| PATCH | `/api/charge-points/:id` | `{ name }` |
| DELETE | `/api/charge-points/:id` | Borra un cargador **desconectado** y su historial (409 si está en línea). Mismo id al reconectar = mismo cargador |
| GET | `/api/charge-points/:id/activity?limit=` | Log de eventos |
| GET | `/api/charge-points/:id/meter-values?limit=` | Histórico de medidas |
| POST | `/api/charge-points/:id/commands` | Body = `ChargePointCommand` → `CommandResult` (incluye `GetConfiguration`/`ChangeConfiguration`: 1.6 nativo, 2.x vía GetVariables/SetVariables con claves `Componente.Variable`; Smart Charging: `SetChargingProfile`, `ClearChargingProfile`, `GetCompositeSchedule`) |
| GET | `/api/transactions?chargePointId=&state=&limit=` | Transacciones |

MQTT (si `MQTT_URL` está definido): contrato de tópicos documentado en `backend/src/protocols/mqtt/schemas.ts`.

## Arquitectura (hexagonal / ports & adapters)

```
            ┌──────────── adaptadores de entrada ────────────┐
 Cargador ─▶│ OcppGateway ─▶ OcppRpcConnection ─▶ OcppVersion │──┐
 (WS)       │  (upgrade,      (framing OCPP-J,    (handlers + │  │
            │  subprotocolo)   colas, timeouts)    commands)  │  │   ┌───────────────────┐
 Cargador ─▶│ MqttGateway (tópicos → rutas zod)               │──┼──▶│ ChargingService   │──▶ Repositories (memoria)
 (MQTT)     └─────────────────────────────────────────────────┘  │   │ (única lógica de  │
                                                                 │   │  negocio)         │──▶ EventBus ──▶ LiveGateway ──▶ Dashboard
 Dashboard ─▶ Express /api ─▶ CommandService ─▶ ConnectionRegistry ─▶ ChargePointConnection.execute() (OCPP o MQTT)
```

```
shared/src/index.ts                    Tipos de dominio + LiveEvent + ChargePointCommand (solo tipos)
backend/src/
  main.ts                              Composition root: ÚNICO lugar con `new` de implementaciones concretas
  config/env.ts                        Lectura de variables de entorno
  core/
    errors.ts                          AppError (status + code) → la capa HTTP lo traduce
    events/EventBus.ts                 Observer
    ports/repositories.ts              Interfaces Repository (async)
    ports/ChargePointConnection.ts     Puerto de salida hacia un cargador
    auth/AuthorizationStrategy.ts      Strategy: AcceptAll | LocalList
    services/ChargingService.ts        Lógica de negocio (boot, status, authorize, transacciones, medidas)
    services/CommandService.ts         Facade para comandos remotos
    services/ConnectionRegistry.ts     Conexiones vivas por chargePointId
    services/ActivityLog.ts            Panel "Eventos OCPP"
  infrastructure/persistence/memory/   Implementaciones en memoria de los repositorios
  protocols/
    ProtocolGateway.ts                 Interfaz común de gateways
    ocpp/OcppGateway.ts                Servidor WS, negociación de subprotocolo, keep-alive ping
    ocpp/OcppVersionFactory.ts         Factory/Registry: subprotocolo → OcppVersion
    ocpp/rpc/frames.ts                 CALL/CALLRESULT/CALLERROR (+ CALLRESULTERROR y SEND de 2.1)
    ocpp/rpc/OcppRpcConnection.ts      Conexión OCPP-J genérica (igual para todas las versiones)
    ocpp/common/handler.ts             ActionHandler (Command pattern) + defineHandler
    ocpp/common/OcppVersion.ts         Strategy por versión + CommandMapper (Adapter)
    ocpp/common/sampledValues.ts       Normalización de MeterValues (unidades, fases)
    ocpp/v16/                          schemas.ts · handlers.ts · commands.ts · index.ts
    ocpp/v201/                         Igual para 2.0.1; index.ts exporta también `ocpp21`
    mqtt/                              MqttGateway + schemas (contrato de tópicos)
  http/                                Express app, rutas, middleware de errores
  live/LiveGateway.ts                  WS /live: reenvía el EventBus al navegador
backend/scripts/simulator-ocpp16.ts    Cargador simulado
frontend/src/
  api/http.ts                          Cliente REST (único módulo que conoce rutas)
  api/liveSocket.ts                    WS /live con reconexión exponencial
  store/index.ts                       Store Zustand compuesto por slices (+ devtools)
  store/slices/chargingSlice.ts        Datos del backend + aplicación de LiveEvents
  store/slices/uiSlice.ts              Navegación y selección
  store/selectors.ts                   Hooks derivados (useSessionView, ...)
  components/{layout,session,ui}/      Componentes de presentación
  store/slices/emulatorSlice.ts        Instancia del cargador emulado (sigue viva al cambiar de página)
  emulator/                            Cargador OCPP emulado (lado Charge Point)
    rpc.ts                             Cliente OCPP-J sobre WebSocket del navegador (cola serie, timeouts)
    profiles.ts                        Strategy por versión: .req salientes y comandos entrantes (1.6 / 2.0.1 / 2.1)
    configuration.ts                   Claves Core 1.6 (§9.1) ↔ variables del Device Model 2.x, validación §5.3/§3.16.4
    measurands.ts                      Measurands medibles (AC sin SoC) y armado de muestras con ReadingContext
    EmulatedCharger.ts                 Máquina de estados §4.9, Boot §4.2, cola de transacción §3.7, MeterValues §3.16, comandos §5
  components/emulator/                 Conexión, vehículo, medidor, Emulador vs CSMS, mensajes manuales, tráfico
  components/session/CarScene.tsx      Escena 3D (three.js, carga diferida vía LazyCarScene)
  pages/                               Session · Chargers · History · Profiles (Smart Charging) · Emulator · Settings
  styles/tokens.css, app.css           Tokens de diseño (tema oscuro) y estilos
```

### Patrones de diseño usados (respetarlos)

| Patrón | Dónde | Para qué |
|---|---|---|
| **Adapter / Ports & Adapters** | `protocols/*`, `ChargePointConnection` | Cada protocolo traduce a/desde el dominio. El núcleo no importa nada de `protocols/` ni `http/`. |
| **Strategy** | `OcppVersion` (1.6 / 2.0.1 / 2.1), `AuthorizationStrategy` | Lo que varía por versión o política se inyecta. |
| **Factory / Registry** | `OcppVersionFactory` | Elegir la versión según el subprotocolo negociado. |
| **Command** | `ActionHandler` por acción OCPP en un `HandlerRegistry` | Sin cadenas if/else; agregar acción = agregar entrada. |
| **Observer** | `EventBus` → `LiveGateway`, `ActivityLog` | Los servicios publican; los consumidores se suscriben. |
| **Repository** | `core/ports/repositories.ts` | Persistencia intercambiable (memoria hoy; SQL mañana). |
| **Facade** | `CommandService` | La API envía comandos sin conocer el protocolo. |
| **Composition root / DI manual** | `main.ts` | Sin singletons (`getInstance`) ni imports de implementaciones concretas fuera de `main.ts`. |
| **Slices + selectores** | Zustand | Un store, slices por responsabilidad, selectores finos. |

## Reglas de OCPP que el código ya cumple (no romper)

Referencia: especificación **OCPP 1.6 edición 2** en `sources/FHWA-2022-0008-0403_attachment_6-1.pdf` (§4 mensajes del Charge Point, §5 del Central System, §6 campos de cada `.req/.conf`, §3.16 Metering Data). `sources/OCPP/` es el **proyecto original** (Bun + Hono + Mongo) usado solo como referencia de funcionalidad; **no se importa ni se copia su estructura**.

1. **Framing**: `[2,id,action,payload]` / `[3,id,payload]` / `[4,id,code,desc,details]`. 2.1 añade `5` (CALLRESULTERROR) y `6` (SEND, sin respuesta).
2. **Orden**: los CALL entrantes de un cargador se procesan en serie (cola en `OcppRpcConnection`). Las respuestas (3/4/5) se resuelven fuera de esa cola para evitar deadlocks.
3. **Un solo CALL saliente pendiente por conexión** (cola serie + timeout `OCPP_CALL_TIMEOUT_MS`).
4. **Errores**: payload inválido → `FormatViolation` (en 1.6 se envía como `FormationViolation`; `OccurrenceConstraintViolation` → `OccurenceConstraintViolation`, errata oficial). Acción desconocida → `NotImplemented`. Excepción no controlada → `InternalError`. Cargador con Boot `Rejected` → `SecurityError` en todo salvo BootNotification.
5. **StartTransaction (1.6)** siempre devuelve `transactionId` aunque el idTag sea inválido (§4.8); es el cargador quien detiene.
6. **transactionId**: en 1.6 lo genera el CSMS (entero secuencial, `OCPP_TRANSACTION_ID_START`); en 2.x lo genera el cargador (string). En el dominio siempre es `string`.
7. **connectorId 0** = el cargador completo. En 2.x el dominio usa `evseId` como `connectorId`.
8. **Estados**: el dominio usa el vocabulario de 1.6. En 2.x `Occupied` + `chargingState` de `TransactionEvent` se mapean a Preparing/Charging/Suspended*; `Ended` → `Finishing` aunque traiga `chargingState`.
9. **MeterValues**: todo se normaliza a W, Wh, V, A, °C, % en `sampledValues.ts` (kW/kWh, multiplicador 10^n de 2.x, measurand por defecto `Energy.Active.Import.Register`, fases: V promedio, A máximo, P/E suma). `SignedData` se ignora.
10. **No inventar estados**: la UI muestra "—"/"Sin StatusNotification" cuando el cargador no informó un dato; nada de valores por defecto (estado, potencia máxima, idTag, errorCode). `lastHeartbeatAt` solo cambia con un Heartbeat real.
11. **Transacciones en el CSMS**: un StartTransaction 1.6 repetido (mismo conector, idTag, meterStart y timestamp) recibe el MISMO transactionId; si un conector inicia otra transacción, la anterior se cierra como "Sin StopTransaction" (un StopTransaction tardío la corrige). En 2.x, si el Started no trae medidas, la primera lectura del registro es el meterStart, y un idToken que llega en un Updated se asigna a la transacción.
12. **Boot Rejected**: el CSMS no inicia mensajes hacia ese cargador (§4.2): la API responde 409 `CHARGE_POINT_REJECTED`. Un ChangeConfiguration de HeartbeatInterval aceptado actualiza `heartbeatIntervalSec`.
13. **Validación de entrada (§6/§7)**: enums de 1.6 (ChargePointErrorCode, Measurand, ReadingContext, Phase, Location, UnitOfMeasure, Reason, estados), CiString20/25/50/255/500 y `dateTime` ISO 8601 con zona. El código CALLERROR depende de la violación: falta un requerido → `OccurenceConstraintViolation` (1.6) / `OccurrenceConstraintViolation` (2.x); tipo JSON o dateTime inválido → `TypeConstraintViolation`; largo/rango/enum → `PropertyConstraintViolation`; payload que no es objeto → `FormationViolation`/`FormatViolation`. Los comandos 1.6 salientes se validan contra los CiString de 1.6 antes de enviarse (HTTP 400).
14. **Eventos**: cada `ActivityEntry` lleva `message` en lenguaje de operador (`protocols/ocpp/common/humanize.ts`); `action`/`summary` quedan como detalle técnico ("Ver OCPP").
15. **Re-conexión**: una nueva conexión con el mismo id cierra la anterior; el `close` tardío del socket viejo no marca offline al nuevo (`ConnectionRegistry.unregister` compara instancia).

## Recetas

### Agregar una acción entrante OCPP (ej. `Reservation` en 1.6)
1. Esquema zod en `protocols/ocpp/v16/schemas.ts` (campos según §6 del PDF).
2. Handler con `defineHandler(schema, async ({ chargePointId, charging }, p) => ({ response, summary }))` en `v16/handlers.ts`.
3. Si requiere lógica de negocio nueva, agrégala como método de `ChargingService` (nunca lógica de negocio en el handler; el handler solo traduce).

### Emulador: reglas que implementa (no romper)
- Antes de `BootNotification` Accepted no sale ningún otro request; con Pending solo lo pedido por TriggerMessage y RemoteStart/Stop → Rejected; con Rejected no responde nada (§4.2). Una reconexión sin reinicio NO repite el Boot.
- MeterValues: solo `MeterValuesSampledData` cada `MeterValueSampleInterval` desde el inicio de la transacción; clock-aligned con `ClockAlignedDataInterval` alineado a medianoche (timestamp = inicio del intervalo); `transactionData` según `StopTxnSampledData`/`StopTxnAlignedData` (vacíos → sin datos). Measurand no soportado → ChangeConfiguration `Rejected`.
- Start/Stop/MeterValues de transacción van por una cola ordenada que sobrevive cortes de comunicación y reintenta con `TransactionMessageAttempts/RetryInterval` (§3.7). En 2.x los generados offline llevan `offline: true` y `seqNo` correlativo.
- Claves §9.1: Accessibility y tipo según la tabla del PDF (p. ej. LocalAuthorizeOffline/LocalPreAuthorize son RW; ConnectorPhaseRotation es CSL `conector.rotación` con su MaxLength). Una CSL sin clave MaxLength admite 1 elemento (§5.3).
- Comandos entrantes 1.6 validados con `emulator/schema16.ts`; acción de 1.6 de un perfil no declarado → `NotSupported`, acción desconocida → `NotImplemented`.
- Física: fluctuaciones (tensión ±2,5 %, potencia ±1,5 %, calentamiento) y protecciones automáticas con errorCode §7.6: AC fuera de 207–253 V → UnderVoltage/OverVoltage (Faulted); ≥ 60 °C → HighTemperature aviso y 50 % de potencia; ≥ 75 °C → Faulted hasta < 70 °C. Eventos aleatorios opcionales: pausa del EV (SuspendedEV) y EVCommunicationError (SuspendedEVSE, warning). Red: lenta (latencia sin reordenar) o inestable (cortes + WeakSignal en conector 0).
- Smart Charging (`emulator/smartCharging.ts`, §3.13): ChargePointMaxProfile solo en conector 0, TxProfile solo con transacción activa, reemplazo por id o stackLevel+purpose, mayor stackLevel prevalece, límite = min(ChargePointMax, TxProfile ?? TxDefault), Absolute/Relative/Recurring, numberPhases por defecto 3; < 6 A en AC → SuspendedEVSE; el TxProfile se descarta al terminar. Claves §9.4 de solo lectura.
- Tiempo real (sin aceleración): energía = potencia × tiempo; el registro de energía es monótono y no se reinicia por transacción.

### Agregar un comando saliente
1. Nueva variante en `ChargePointCommand` (`shared/src/index.ts`).
2. Mapeo en **cada** `CommandMapper` (`v16/commands.ts`, `v201/commands.ts`) — el `switch` es exhaustivo, TypeScript avisa si falta.
3. Variante en el `CommandSchema` de `http/routes/chargePoints.ts`.
4. MQTT lo publica automáticamente en `{prefix}/{id}/cmd/{type}`.

### Agregar una versión de OCPP
1. Carpeta `protocols/ocpp/vXYZ/` con `schemas.ts`, `handlers.ts`, `commands.ts`, `index.ts` exportando un `OcppVersion`.
2. Registrar en `VERSIONS` y `SUPPORTED_SUBPROTOCOLS` de `OcppVersionFactory.ts`, y en `ProtocolId`/`PROTOCOL_LABELS` de `shared`.
3. Si es compatible con otra, reutiliza su registro: `handlers: { ...ocpp201Handlers, NuevaAccion }`.

### Agregar otro protocolo (ej. Modbus, HTTP webhook)
Implementa `ProtocolGateway` + una `ChargePointConnection`, traduce al `ChargingService`, registra conexiones en `ConnectionRegistry` y regístralo en `main.ts`. No toques el núcleo.

### Cambiar la persistencia (Postgres, SQLite, Redis)
Implementa las interfaces de `core/ports/repositories.ts` en `infrastructure/persistence/<motor>/` y cambia **solo** las líneas de `repos` en `main.ts`. **No usar MongoDB.**

### Frontend: nuevo dato en el dashboard
1. Si viene del backend, llega por `LiveEvent` → se aplica en `chargingSlice.applyLiveEvent`.
2. Deriva en `store/selectors.ts` con `useMemo` (nunca devuelvas objetos nuevos directamente desde un selector de Zustand: provoca renders infinitos).
3. Componente de presentación en `components/session/` que recibe `view` por props o usa un selector.

## Convenciones

- TypeScript estricto (`noUncheckedIndexedAccess`). `npm run typecheck` debe pasar antes de terminar cualquier tarea.
- Backend ESM con `NodeNext`: **los imports relativos llevan extensión `.js`**.
- `@ev/shared` es solo de tipos: impórtalo **siempre con `import type`** (excepto la constante `PROTOCOL_LABELS`, que el frontend importa como valor vía Vite).
- Valida toda entrada externa con zod (frames OCPP, mensajes MQTT, cuerpos HTTP).
- Unidades internas: W, Wh, V, A, °C, %. Convierte a kW/kWh solo al mostrar (`frontend/src/lib/format.ts`).
- Textos de UI y comentarios en español; nombres de código y acciones OCPP en inglés.
- Navegación: la vista vive en el hash (`#/sesion`, `#/cargadores`, `#/historial`, `#/perfiles`, `#/emulador`, `#/ajustes`); usa `setView`, que actualiza la URL (Atrás/recargar funcionan).
- Dato no informado por el cargador: `<NoData/>` (texto explícito), nunca una raya grande ni un valor por defecto.
- Acciones destructivas (Reset, borrar): confirmación con segundo clic.
- Formularios: campo obligatorio (1..1) = input `required` (ámbar mientras está vacío) + `<Req/>`; omitible (0..1) = `<Opt/>` (asterisco).
- UI: usa los tokens de `styles/tokens.css`; no introducir colores sueltos ni librerías de componentes sin acordarlo.
- El dashboard replica el diseño de referencia: sidebar (Sesión, Cargadores, Historial, Ajustes), topbar (hora, estación·conector, estado, CP-id, protocolo), columna izquierda (Potencia, Batería, Temperatura), centro (Autorizado, escena del vehículo con SoC, barra de transacción con "Detener carga"), derecha (Cargador, Eventos OCPP, Cargador en línea).

## Pendientes conocidos

- Persistencia real (los datos se pierden al reiniciar el backend).
- Seguridad OCPP: Basic Auth (Security Profile 1/2) y TLS (`wss://`), autenticación del dashboard/API.
- Reservas (ReserveNow/CancelReservation), Local Authorization List (SendLocalList/GetLocalListVersion), actualizaciones de firmware.
- Tests automáticos (sugerido: `vitest` para `sampledValues`, handlers y `ChargingService`; `EmulatedCharger` funciona también en Node 22, así que sirve de base para tests E2E contra el backend).
- El emulador modela un solo conector.
