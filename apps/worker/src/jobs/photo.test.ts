import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { encodeVariants } from './photo';

async function cameraJpeg(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 80 } } })
    .jpeg()
    .withMetadata({
      orientation: 6,
      exif: {
        IFD0: { Make: 'TestPhone', Copyright: 'guest' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 13/1 0/1' },
      },
    })
    .toBuffer();
}

describe('encodeVariants', () => {
  it('produces three variants without any metadata and applies orientation', async () => {
    const out = await encodeVariants(await cameraJpeg(3000, 2000));
    expect(out?.map((v) => v.name)).toEqual(['thumb', 'large', 'full']);

    for (const v of out!) {
      const meta = await sharp(v.data).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
      expect(meta.format).toBe(v.contentType === 'image/webp' ? 'webp' : 'jpeg');
    }
    const thumb = out!.find((v) => v.name === 'thumb')!;
    // Orientation 6 means rotate 90°, so the landscape source becomes portrait.
    expect([thumb.width, thumb.height]).toEqual([267, 400]);
    const full = out!.find((v) => v.name === 'full')!;
    expect([full.width, full.height]).toEqual([2000, 3000]);
  });

  it('never upscales small images', async () => {
    const out = await encodeVariants(
      await sharp({ create: { width: 300, height: 200, channels: 3, background: '#fff' } })
        .png()
        .toBuffer(),
    );
    expect(out?.every((v) => v.width === 300 && v.height === 200)).toBe(true);
  });

  it('rejects files that are not images, whatever they claim to be', async () => {
    expect(await encodeVariants(Buffer.from('<?php echo "hi"; ?>'))).toBeNull();
    expect(
      await encodeVariants(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(100)])),
    ).toBeNull();
  });
});
