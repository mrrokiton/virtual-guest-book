import { guestCanUpload } from '@vgb/core';
import { weddingScope, type GuestSession, type Wedding } from '@vgb/db';
import { db } from './server';

export interface GuestBingoSubmission {
  id: string;
  mediaId: string;
  mediaStatus: string;
  status: 'pending' | 'accepted' | 'rejected';
  rejectionReason: string | null;
  thumbUrl: string | null;
}

export interface GuestBingoData {
  displayName: string | null;
  canUpload: boolean;
  tasks: {
    id: string;
    body: string;
    submissions: GuestBingoSubmission[];
  }[];
  validators: { id: string; fullName: string; nickname: string | null }[];
}

export async function loadGuestBingo(
  wedding: Wedding,
  session: GuestSession,
  slug: string,
): Promise<GuestBingoData> {
  const data = await weddingScope(db(), wedding.id).bingo.guestData(session.id);
  const byTask = new Map<string, GuestBingoSubmission[]>();
  for (const row of data.submissions) {
    const list = byTask.get(row.submission.taskId) ?? [];
    list.push({
      id: row.submission.id,
      mediaId: row.media.id,
      mediaStatus: row.media.status,
      status: row.submission.status,
      rejectionReason: row.submission.rejectionReason,
      thumbUrl:
        row.media.status === 'ready' ? `/api/w/${slug}/media/${row.media.id}/file?v=thumb` : null,
    });
    byTask.set(row.submission.taskId, list);
  }
  return {
    displayName: session.displayName,
    canUpload: guestCanUpload(wedding, new Date()),
    tasks: data.tasks.map((task) => ({
      id: task.id,
      body: task.body,
      submissions: byTask.get(task.id) ?? [],
    })),
    validators: data.validators.map(({ id, fullName, nickname }) => ({
      id,
      fullName,
      nickname,
    })),
  };
}
