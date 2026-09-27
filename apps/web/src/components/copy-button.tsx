'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      className={className}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? 'Skopiowano' : 'Kopiuj link'}
    </Button>
  );
}
