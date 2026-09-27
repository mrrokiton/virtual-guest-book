'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state.error ? (
        <Alert tone="danger" className="mt-3">
          {state.error}
        </Alert>
      ) : null}
      {state.ok ? (
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
