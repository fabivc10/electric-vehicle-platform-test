import { lazy, Suspense } from 'react';
import type { CarSceneProps } from './CarScene';

/** three.js pesa ~600 kB: la escena 3D se carga aparte para no frenar el primer render. */
const CarScene = lazy(() => import('./CarScene').then((m) => ({ default: m.CarScene })));

export const LazyCarScene = (props: CarSceneProps) => (
  <Suspense fallback={<div className="scene" aria-busy="true" />}>
    <CarScene {...props} />
  </Suspense>
);
