import { guestCanUpload } from '@vgb/core';
import { weddingScope, type GuestSession, type Wedding } from '@vgb/db';
import { db } from './server';

export interface GuestBingoData {
  displayName: string | null;
  canUpload: boolean;
  tasks: {
    id: string;
    body: string;
    submission: {
      id: string;
      mediaId: string;
      mediaStatus: string;
      status: 'pending' | 'accepted' | 'rejected';
      rejectionReason: string | null;
      thumbUrl: string | null;
    } | null;
  }[];
  validators: { id: string; fullName: string; nickname: string | null }[];
}

export async function loadGuestBingo(
  wedding: Wedding,
  session: GuestSession,
  slug: string,
): Promise<GuestBingoData> {
  const data = await weddingScope(db(), wedding.id).bingo.guestData(session.id);
  const byTask = new Map(data.submissions.map((row) => [row.submission.taskId, row]));
  return {
    displayName: session.displayName,
    canUpload: guestCanUpload(wedding, new Date()),
    tasks: data.tasks.map((task) => {
      const row = byTask.get(task.id);
      return {
        id: task.id,
        body: task.body,
        submission: row
          ? {
              id: row.submission.id,
              mediaId: row.media.id,
              mediaStatus: row.media.status,
              status: row.submission.status,
              rejectionReason: row.submission.rejectionReason,
              thumbUrl:
                row.media.status === 'ready'
                  ? `/api/w/${slug}/media/${row.media.id}/file?v=thumb`
                  : null,
            }
          : null,
      };
    }),
    validators: data.validators.map(({ id, fullName, nickname }) => ({
      id,
      fullName,
      nickname,
    })),
  };
}
