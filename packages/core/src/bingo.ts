export const BINGO_MODULE_KEY = 'party_bingo';

export const BINGO_SUBMISSION_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type BingoSubmissionStatus = (typeof BINGO_SUBMISSION_STATUSES)[number];

export type BingoProgressStatus =
  'incomplete' | 'awaiting_verification' | 'needs_correction' | 'completed';

export type BingoTileStatus =
  'todo' | 'processing' | 'failed' | 'pending' | 'accepted' | 'rejected';

export interface BingoPhotoState {
  taskId: string;
  status: BingoSubmissionStatus;
  mediaStatus: string;
  withdrawn: boolean;
}

export interface BingoEvaluation {
  status: BingoProgressStatus;
  photosComplete: boolean;
  bingoAccepted: boolean;
  tasksWithQualifying: number;
  acceptedCount: number;
  pendingCount: number;
  rejectedWithoutReplacement: number;
  photosCompletedAt: Date | null;
}

export interface BingoParticipantSort {
  name: string;
  tasksWithQualifying: number;
  photosCompletedAt: Date | null;
}

const QUALIFYING = new Set<BingoSubmissionStatus>(['pending', 'accepted']);

export function isQualifyingBingoPhoto(photo: BingoPhotoState): boolean {
  return !photo.withdrawn && photo.mediaStatus === 'ready' && QUALIFYING.has(photo.status);
}

export function evaluateBingo(input: {
  taskIds: readonly string[];
  photos: readonly BingoPhotoState[];
  previousCompletedAt: Date | null;
  now: Date;
}): BingoEvaluation {
  const active = input.photos.filter((photo) => !photo.withdrawn);
  const qualifyingTasks = new Set<string>();
  const acceptedTasks = new Set<string>();
  const rejectedTasks = new Set<string>();
  let acceptedCount = 0;
  let pendingCount = 0;
  let rejectedWithoutReplacement = 0;

  for (const photo of active) {
    if (!input.taskIds.includes(photo.taskId)) continue;
    if (isQualifyingBingoPhoto(photo)) {
      qualifyingTasks.add(photo.taskId);
      if (photo.status === 'accepted') {
        acceptedTasks.add(photo.taskId);
        acceptedCount += 1;
      } else pendingCount += 1;
    } else if (photo.mediaStatus === 'ready' && photo.status === 'rejected') {
      rejectedTasks.add(photo.taskId);
    }
  }
  for (const photo of active) {
    if (
      input.taskIds.includes(photo.taskId) &&
      photo.mediaStatus === 'ready' &&
      photo.status === 'rejected' &&
      !qualifyingTasks.has(photo.taskId)
    ) {
      rejectedWithoutReplacement += 1;
    }
  }

  const photosComplete =
    input.taskIds.length > 0 && input.taskIds.every((taskId) => qualifyingTasks.has(taskId));
  const bingoAccepted =
    input.taskIds.length > 0 && input.taskIds.every((taskId) => acceptedTasks.has(taskId));
  const needsCorrection = input.taskIds.some(
    (taskId) => !qualifyingTasks.has(taskId) && rejectedTasks.has(taskId),
  );
  const status: BingoProgressStatus = needsCorrection
    ? 'needs_correction'
    : !photosComplete
      ? 'incomplete'
      : bingoAccepted
        ? 'completed'
        : 'awaiting_verification';

  return {
    status,
    photosComplete,
    bingoAccepted,
    tasksWithQualifying: input.taskIds.filter((taskId) => qualifyingTasks.has(taskId)).length,
    acceptedCount,
    pendingCount,
    rejectedWithoutReplacement,
    photosCompletedAt: photosComplete ? (input.previousCompletedAt ?? input.now) : null,
  };
}

export function taskTileStatus(photos: readonly BingoPhotoState[]): BingoTileStatus {
  const active = photos.filter((photo) => !photo.withdrawn);
  if (active.length === 0) return 'todo';
  if (active.some((photo) => isQualifyingBingoPhoto(photo) && photo.status === 'pending')) {
    return 'pending';
  }
  if (active.some((photo) => isQualifyingBingoPhoto(photo) && photo.status === 'accepted')) {
    return 'accepted';
  }
  if (active.some((photo) => photo.mediaStatus === 'ready' && photo.status === 'rejected')) {
    return 'rejected';
  }
  if (
    active.some((photo) => photo.mediaStatus === 'uploading' || photo.mediaStatus === 'processing')
  ) {
    return 'processing';
  }
  if (active.some((photo) => photo.mediaStatus === 'failed')) return 'failed';
  return 'todo';
}

export function compareBingoParticipants(a: BingoParticipantSort, b: BingoParticipantSort): number {
  if (a.photosCompletedAt && b.photosCompletedAt) {
    const byTime = a.photosCompletedAt.getTime() - b.photosCompletedAt.getTime();
    if (byTime !== 0) return byTime;
  } else if (a.photosCompletedAt) return -1;
  else if (b.photosCompletedAt) return 1;
  else if (a.tasksWithQualifying !== b.tasksWithQualifying) {
    return b.tasksWithQualifying - a.tasksWithQualifying;
  }
  return a.name.localeCompare(b.name, 'pl');
}
