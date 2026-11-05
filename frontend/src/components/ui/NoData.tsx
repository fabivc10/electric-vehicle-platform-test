/** Valor que el cargador no informó: texto explícito en vez de una raya que parece una barra de carga. */
export const NoData = ({ label = 'sin dato', title }: { label?: string; title?: string }) => (
  <span className="nodata" title={title ?? 'El cargador todavía no informó este valor'}>
    {label}
  </span>
);
