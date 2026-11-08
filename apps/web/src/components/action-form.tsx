'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  notify = 'inline',
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  notify?: 'inline' | 'toast';
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const ref = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const toasted = notify === 'toast' && toast;

  useEffect(() => {
    if (resetOnSuccess && state.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);

  useEffect(() => {
    if (!toasted || !toast) return;
    if (state.error) toast.push(state.error, 'danger');
    else if (state.ok) toast.push(state.ok, 'success');
  }, [state.error, state.ok, toast, toasted]);

  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {!toasted && state.error ? (
        <Alert tone="danger" className="mt-3">
          {state.error}
        </Alert>
      ) : null}
      {!toasted && state.ok ? (
        <Alert tone="success" className="mt-3">
          {state.ok}
        </Alert>
      ) : null}
    </form>
  );
}

export function SubmitButton({
  children,
  pendingText,
  ...props
}: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? (pendingText ?? 'Chwileczkę…') : children}
    </Button>
  );
}
