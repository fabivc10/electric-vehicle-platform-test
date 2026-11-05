import type { ReactNode } from 'react';

export const Card = ({
  title,
  aside,
  className = '',
  children,
}: {
  title?: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) => (
  <section className={`card ${className}`}>
    {(title || aside) && (
      <header className="card__head">
        {title && <h2 className="eyebrow">{title}</h2>}
        {aside}
      </header>
    )}
    {children}
  </section>
);

export const Stat = ({ label, value, unit }: { label: string; value: ReactNode; unit?: string }) => (
  <div className="stat">
    <span className="stat__label">{label}</span>
    <span className="stat__value">
      {value}
      {unit && <small> {unit}</small>}
    </span>
  </div>
);

export const EmptyState = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="empty">
    <h3>{title}</h3>
    {children}
  </div>
);
