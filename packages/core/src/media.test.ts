import { describe, expect, it } from 'vitest';
import { detectMedia } from './media';

function ftyp(major: string, ...compatible: string[]): Uint8Array {
  const brands = [major, '\0\0\0\0', ...compatible].join('');
  const size = 8 + brands.length;
  const buf = new Uint8Array(size + 16);
  new DataView(buf.buffer).setUint32(0, size);
  buf.set(new TextEncoder().encode('ftyp' + brands), 4);
  return buf;
}

describe('detectMedia', () => {
  it('recognizes common photo formats by magic bytes', () => {
    expect(detectMedia(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.mime).toBe('image/jpeg');
    expect(
      detectMedia(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime,
    ).toBe('image/png');
    expect(detectMedia(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))?.mime).toBe('image/webp');
  });

  it('distinguishes HEIC, AVIF, MP4 and QuickTime by ftyp brands', () => {
    expect(detectMedia(ftyp('heic', 'mif1', 'heic'))?.mime).toBe('image/heic');
    expect(detectMedia(ftyp('mif1', 'avif', 'mif1'))?.mime).toBe('image/avif');
    expect(detectMedia(ftyp('isom', 'iso2', 'avc1', 'mp41'))).toEqual({
      kind: 'video',
      mime: 'video/mp4',
    });
    expect(detectMedia(ftyp('qt  ', 'qt  '))).toEqual({ kind: 'video', mime: 'video/quicktime' });
  });

  it('rejects files whose extension lies about the content', () => {
    const script = new TextEncoder().encode('<script>alert(1)</script>');
    expect(detectMedia(script)).toBeNull();
    expect(detectMedia(new TextEncoder().encode('%PDF-1.7\n'))).toBeNull();
  });
});
