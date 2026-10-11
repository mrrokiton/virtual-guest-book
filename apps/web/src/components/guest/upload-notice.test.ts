import { describe, expect, it } from 'vitest';
import { isSameSuccessBatch, uploadNoticePhase, type UploadNoticeTask } from './upload-notice';

const task = (key: string, status: UploadNoticeTask['status']): UploadNoticeTask => ({
  key,
  status,
});

describe('uploadNoticePhase', () => {
  it('hides an empty queue', () => {
    expect(uploadNoticePhase([])).toBe('hidden');
  });

  it('stays open while anything is still sending', () => {
    expect(uploadNoticePhase([task('a', 'done'), task('b', 'working')])).toBe('working');
    expect(uploadNoticePhase([task('a', 'queued')])).toBe('working');
  });

  it('stays open when any row failed', () => {
    expect(uploadNoticePhase([task('a', 'done'), task('b', 'error')])).toBe('error');
  });

  it('is success only when every row is done', () => {
    expect(uploadNoticePhase([task('a', 'done'), task('b', 'done')])).toBe('success');
  });
});

describe('isSameSuccessBatch', () => {
  it('matches the batch that armed the timer', () => {
    const rows = [task('a', 'done'), task('b', 'done')];
    expect(isSameSuccessBatch(rows, ['a', 'b'])).toBe(true);
  });

  it('does not dismiss a newer row or an error that arrived later', () => {
    expect(isSameSuccessBatch([task('a', 'done'), task('c', 'queued')], ['a'])).toBe(false);
    expect(isSameSuccessBatch([task('a', 'done'), task('b', 'error')], ['a', 'b'])).toBe(false);
    expect(isSameSuccessBatch([task('a', 'done')], ['a', 'b'])).toBe(false);
  });
});
