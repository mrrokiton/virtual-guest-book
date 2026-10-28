export const BINGO_MODULE_KEY = 'party_bingo';

export const BINGO_SUBMISSION_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type BingoSubmissionStatus = (typeof BINGO_SUBMISSION_STATUSES)[number];

export type BingoProgressStatus =
  'incomplete' | 'awaiting_verification' | 'needs_correction' | 'completed';

export interface BingoProgressInput {
  taskCount: number;
  submittedCount: number;
  pendingCount: number;
  rejectedCount: number;
  acceptedCount: number;
}

export function bingoProgress(input: BingoProgressInput): BingoProgressStatus {
  if (input.rejectedCount > 0) return 'needs_correction';
  if (input.submittedCount < input.taskCount) return 'incomplete';
  if (input.taskCount > 0 && input.acceptedCount === input.taskCount) return 'completed';
  return 'awaiting_verification';
}
