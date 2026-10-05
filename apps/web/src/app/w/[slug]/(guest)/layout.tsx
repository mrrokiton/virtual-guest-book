import { planLimits, VIDEO_DURATION_TOLERANCE_S } from '@vgb/core';
import type { ReactNode } from 'react';
import { GuestUploadProvider } from '@/components/guest/guest-upload';
import { findWedding } from '@/lib/guest';

export const dynamic = 'force-dynamic';

export default async function GuestZoneLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const wedding = await findWedding(slug);
  if (!wedding || wedding.status === 'deleted') return children;
  const limits = planLimits(wedding.plan);
  return (
    <GuestUploadProvider
      slug={slug}
      limits={{
        maxPhotoBytes: limits.maxPhotoBytes,
        maxVideoBytes: limits.maxVideoBytes,
        maxVideoSeconds: limits.maxVideoSeconds,
        videoToleranceSeconds: VIDEO_DURATION_TOLERANCE_S,
      }}
    >
      {children}
    </GuestUploadProvider>
  );
}
