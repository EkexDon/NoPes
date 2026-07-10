/**
 * confetti.ts — dependency-free celebration burst.
 * Spawns absolutely-positioned particles that fall with CSS animations,
 * then removes the container. Colors follow the active theme.
 */

import { cssToken } from './themes';

export function fireConfetti(particleCount = 90): void {
  if (document.getElementById('nopes-confetti')) return; // one burst at a time

  const colors = [
    cssToken('--accent') || '#7c6dff',
    cssToken('--green') || '#34d399',
    cssToken('--amber') || '#fbbf24',
    cssToken('--red') || '#f87171',
    cssToken('--accent-light') || '#a78bfa',
  ];

  const container = document.createElement('div');
  container.id = 'nopes-confetti';
  container.setAttribute('aria-hidden', 'true');

  for (let i = 0; i < particleCount; i++) {
    const p = document.createElement('i');
    const size = 5 + (i % 5) * 1.6;
    const left = ((i * 37) % 100);            // deterministic spread
    const delay = ((i * 53) % 40) / 100;       // 0–0.4s
    const duration = 2 + ((i * 29) % 120) / 100; // 2–3.2s
    const drift = (((i * 17) % 10) - 5) * 12;  // sideways sway
    p.style.cssText = [
      `left:${left}vw`,
      `width:${size}px`,
      `height:${size * (i % 3 === 0 ? 0.4 : 1)}px`,
      `background:${colors[i % colors.length]}`,
      `animation-delay:${delay}s`,
      `animation-duration:${duration}s`,
      `--confetti-drift:${drift}px`,
      i % 2 === 0 ? 'border-radius:50%' : 'border-radius:1px',
    ].join(';');
    container.appendChild(p);
  }

  document.body.appendChild(container);
  setTimeout(() => container.remove(), 4000);
}
