import type { ReactNode } from 'react';

interface OverlayProps {
  tone: 'info' | 'success';
  children: ReactNode;
}

/** Semi-transparent panel that sits on top of the board. */
export function Overlay({ tone, children }: OverlayProps) {
  return (
    <div className={`overlay overlay--${tone}`} role="dialog" aria-modal="true">
      {children}
    </div>
  );
}
