import { describe, expect, it } from 'vitest';
import {
  compareBingoParticipants,
  evaluateBingo,
  taskTileStatus,
  type BingoPhotoState,
} from './bingo';

const at = (iso: string) => new Date(iso);
const photo = (
  taskId: string,
  status: BingoPhotoState['status'],
  mediaStatus = 'ready',
): BingoPhotoState => ({
  taskId,
  status,
  mediaStatus,
  withdrawn: false,
});

describe('evaluateBingo', () => {
  const tasks = ['a', 'b'];

  it('stores the transition time and keeps it when an extra photo changes', () => {
    const first = evaluateBingo({
      taskIds: tasks,
      photos: [photo('a', 'pending'), photo('b', 'pending')],
      previousCompletedAt: null,
      now: at('2026-10-28T19:43:00Z'),
    });
    expect(first.photosCompletedAt).toEqual(at('2026-10-28T19:43:00Z'));
    const extra = evaluateBingo({
      taskIds: tasks,
      photos: [photo('a', 'pending'), photo('a', 'accepted'), photo('b', 'pending')],
      previousCompletedAt: first.photosCompletedAt,
      now: at('2026-10-28T19:50:00Z'),
    });
    expect(extra.photosCompletedAt).toEqual(first.photosCompletedAt);
    expect(extra.status).toBe('awaiting_verification');
  });

  it('clears completion when the only qualifying photo is rejected or removed', () => {
    const rejected = evaluateBingo({
      taskIds: tasks,
      photos: [photo('a', 'rejected'), photo('b', 'accepted')],
      previousCompletedAt: at('2026-10-28T19:43:00Z'),
      now: at('2026-10-28T19:50:00Z'),
    });
    expect(rejected.photosComplete).toBe(false);
    expect(rejected.photosCompletedAt).toBeNull();
    expect(rejected.status).toBe('needs_correction');
    expect(rejected.rejectedWithoutReplacement).toBe(1);

    const removed = evaluateBingo({
      taskIds: tasks,
      photos: [photo('b', 'pending')],
      previousCompletedAt: at('2026-10-28T19:43:00Z'),
      now: at('2026-10-28T19:55:00Z'),
    });
    expect(removed.photosCompletedAt).toBeNull();
    expect(removed.status).toBe('incomplete');
  });

  it('keeps completion when another qualifying photo remains', () => {
    const result = evaluateBingo({
      taskIds: tasks,
      photos: [photo('a', 'rejected'), photo('a', 'pending'), photo('b', 'accepted')],
      previousCompletedAt: at('2026-10-28T19:43:00Z'),
      now: at('2026-10-28T19:50:00Z'),
    });
    expect(result.photosCompletedAt).toEqual(at('2026-10-28T19:43:00Z'));
    expect(result.rejectedWithoutReplacement).toBe(0);
    expect(result.bingoAccepted).toBe(false);
  });

  it('records a new time after the missing task is filled again', () => {
    const result = evaluateBingo({
      taskIds: tasks,
      photos: [photo('a', 'pending'), photo('b', 'pending')],
      previousCompletedAt: null,
      now: at('2026-10-28T20:05:00Z'),
    });
    expect(result.photosCompletedAt).toEqual(at('2026-10-28T20:05:00Z'));
  });

  it('does not move the completion time when a pending photo is accepted', () => {
    const result = evaluateBingo({
      taskIds: tasks,
      photos: [photo('a', 'accepted'), photo('b', 'accepted')],
      previousCompletedAt: at('2026-10-28T20:05:00Z'),
      now: at('2026-10-28T20:10:00Z'),
    });
    expect(result.photosCompletedAt).toEqual(at('2026-10-28T20:05:00Z'));
    expect(result.status).toBe('completed');
  });

  it('recalculates when a required task disappears', () => {
    const result = evaluateBingo({
      taskIds: ['a'],
      photos: [photo('a', 'pending'), photo('b', 'rejected')],
      previousCompletedAt: null,
      now: at('2026-10-28T20:20:00Z'),
    });
    expect(result.photosComplete).toBe(true);
    expect(result.photosCompletedAt).toEqual(at('2026-10-28T20:20:00Z'));
  });
});

describe('taskTileStatus', () => {
  it('uses the task-level status without hiding a qualifying photo behind a rejection', () => {
    expect(taskTileStatus([])).toBe('todo');
    expect(taskTileStatus([photo('a', 'pending', 'processing')])).toBe('processing');
    expect(taskTileStatus([photo('a', 'rejected'), photo('a', 'accepted')])).toBe('accepted');
    expect(taskTileStatus([photo('a', 'accepted'), photo('a', 'pending')])).toBe('pending');
  });
});

describe('compareBingoParticipants', () => {
  it('ranks completed participants by time and leaves incomplete ones below', () => {
    const people = [
      { name: 'Zosia', tasksWithQualifying: 2, photosCompletedAt: null },
      { name: 'Jan', tasksWithQualifying: 2, photosCompletedAt: at('2026-10-28T20:05:00Z') },
      { name: 'Ala', tasksWithQualifying: 1, photosCompletedAt: null },
      { name: 'Ola', tasksWithQualifying: 2, photosCompletedAt: at('2026-10-28T19:43:00Z') },
    ].sort(compareBingoParticipants);
    expect(people.map((person) => person.name)).toEqual(['Ola', 'Jan', 'Zosia', 'Ala']);
  });
});
