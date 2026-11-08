'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  expireToasts,
  pushToast,
  TOAST_VIEWPORT_CLASS,
  type ToastItem,
  type ToastTone,
} from './toast-state';

const ToastContext = createContext<{ push: (message: string, tone?: ToastTone) => void } | null>(
  null,
);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: ToastTone = 'success') => {
    const now = Date.now();
    const id = crypto.randomUUID();
    setItems((current) => {
      const next = pushToast(current, message, tone, now, id);
      const added = next.find((item) => item.id === id);
      if (added) {
        window.setTimeout(() => {
          setItems((latest) => expireToasts(latest, Date.now()));
        }, added.expiresAt - now);
      }
      return next;
    });
  }, []);
  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={TOAST_VIEWPORT_CLASS}>
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            aria-live={item.tone === 'danger' ? 'assertive' : 'polite'}
            className={cn(
              'pointer-events-none max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg',
              item.tone === 'danger'
                ? 'border-danger-muted bg-danger-muted text-danger-foreground'
                : item.tone === 'success'
                  ? 'border-success-muted bg-success-muted text-success-foreground'
                  : 'border-border bg-card',
            )}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
