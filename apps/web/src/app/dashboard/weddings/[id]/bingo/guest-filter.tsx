'use client';

import { usePathname, useRouter } from 'next/navigation';

export function GuestFilter({
  guests,
  selected,
}: {
  guests: { id: string; label: string }[];
  selected: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <label className="block max-w-sm text-sm">
      <span className="mb-1.5 block font-medium">Uczestnik</span>
      <select
        className="h-11 w-full rounded-lg border border-border bg-card px-3"
        value={selected}
        onChange={(event) => {
          const guest = event.target.value;
          router.push(guest ? `${pathname}?guest=${encodeURIComponent(guest)}` : pathname);
        }}
      >
        <option value="">Wszyscy uczestnicy</option>
        {guests.map((guest) => (
          <option key={guest.id} value={guest.id}>
            {guest.label}
          </option>
        ))}
      </select>
    </label>
  );
}
