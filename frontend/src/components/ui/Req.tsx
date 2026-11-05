/**
 * Marcas de campo en formularios:
 *  - Req: obligatorio (cardinalidad 1..1). Punto ámbar; el input lleva `required` y se pinta ámbar mientras está vacío.
 *  - Opt: omitible (cardinalidad 0..1). Asterisco.
 */
export const Req = () => (
  <span className="req" aria-hidden="true" title="Obligatorio">
    ●
  </span>
);

export const Opt = () => (
  <span className="opt" title="Opcional: se puede omitir">
    *
  </span>
);
