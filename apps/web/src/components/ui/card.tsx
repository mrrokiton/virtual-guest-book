import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-card p-5 shadow-sm', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('mb-1 text-lg font-semibold', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mb-4 text-sm text-muted-foreground', className)} {...props} />;
}

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  const tones = {
    neutral: 'bg-muted text-foreground',
    success: 'bg-green-100 text-success',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-red-100 text-destructive',
  };
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Alert({
  className,
  tone = 'neutral',
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: 'neutral' | 'danger' | 'success' }) {
  const tones = {
    neutral: 'border-border bg-muted',
    danger: 'border-red-200 bg-red-50 text-destructive',
    success: 'border-green-200 bg-green-50 text-success',
  };
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-lg border px-4 py-3 text-sm', tones[tone], className)}
      {...props}
    />
  );
}
