import { brand } from './brand.js';

export function Monogram({ size = 40, color = '#2d3d6c', title = 'BrainADZ' }) {
  return (
    <img src={brand.icon} width={size} height={size} className="monogram" alt={title}
      aria-hidden={title ? undefined : true}
      style={{ objectFit: 'contain', flexShrink: 0, ...(color === '#fff' ? { filter: 'brightness(0) invert(1)' } : {}) }} />
  );
}
