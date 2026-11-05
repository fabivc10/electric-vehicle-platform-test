import { useEffect, useState } from 'react';
import type { KeyType } from '../../lib/ocppKeys';

interface Props {
  type: KeyType;
  unit?: string;
  value: string;
  /** §7.29 KeyValue.readonly: el cargador indica que no se puede cambiar con ChangeConfiguration. */
  readonly: boolean;
  disabled?: boolean;
  onCommit: (value: string) => void;
}

/**
 * Control de un valor de configuración OCPP según su tipo (§9): boolean como interruptor
 * true/false, integer como número con unidad, CSL/string como texto. Las claves de solo
 * lectura se muestran bloqueadas.
 */
export const ConfigValue = ({ type, unit, value, readonly, disabled, onCommit }: Props) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (readonly) {
    return (
      <span className="cfg-ro" title="Solo lectura: el cargador no permite cambiarla (readonly = true)">
        <span className="cfg-ro__tag">Solo lectura</span>
        <span className="mono">{value === '' ? '(vacío)' : value.split(',').join(', ')}</span>
        {unit && <span className="muted"> {unit}</span>}
      </span>
    );
  }

  if (type === 'boolean') {
    const on = value.toLowerCase() === 'true';
    return (
      <span className="cfg-bool" role="group" aria-label="Valor booleano">
        {(['true', 'false'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={`cfg-bool__opt ${(v === 'true') === on ? 'is-on' : ''}`}
            aria-pressed={(v === 'true') === on}
            disabled={disabled}
            onClick={() => (v === 'true') !== on && onCommit(v)}
          >
            {v}
          </button>
        ))}
      </span>
    );
  }

  const dirty = draft !== value;
  return (
    <form
      className="cfg-edit"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) onCommit(draft.trim());
      }}
    >
      <input
        className="input mono"
        type={type === 'integer' ? 'number' : 'text'}
        min={type === 'integer' ? 0 : undefined}
        step={type === 'integer' ? 1 : undefined}
        value={draft}
        disabled={disabled}
        placeholder={type === 'CSL' ? 'valor1,valor2' : undefined}
        title={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setDraft(value)}
      />
      {unit && <span className="muted cfg-unit">{unit}</span>}
      {dirty && (
        <button className="btn" disabled={disabled}>
          Aplicar
        </button>
      )}
    </form>
  );
};
