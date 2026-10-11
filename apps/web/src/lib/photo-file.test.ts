import { describe, expect, it } from 'vitest';
import { PHOTO_DOWNLOAD_CONTENT_TYPE, photoDownloadName, photoFileAccess } from './photo-file';

const id = '11111111-1111-4111-8111-111111111111';

describe('photoFileAccess', () => {
  it('signs a full photo download with an attachment name and octet-stream', () => {
    expect(photoFileAccess('full', true, id)).toEqual({
      mode: 'download',
      variant: 'full',
      downloadName: photoDownloadName(id),
      responseContentType: PHOTO_DOWNLOAD_CONTENT_TYPE,
    });
    expect(photoDownloadName(id)).toBe(`zdjecie-${id}.jpg`);
  });

  it('refuses a download of any variant other than full', () => {
    expect(photoFileAccess('large', true, id)).toBeNull();
    expect(photoFileAccess('thumb', true, id)).toBeNull();
    expect(photoFileAccess('original', true, id)).toBeNull();
  });

  it('keeps gallery variants inline and without download headers', () => {
    expect(photoFileAccess('large', false, id)).toEqual({ mode: 'inline', variant: 'large' });
    expect(photoFileAccess('thumb', false, id)).toEqual({ mode: 'inline', variant: 'thumb' });
    expect(photoFileAccess('full', false, id)).toEqual({ mode: 'inline', variant: 'full' });
    expect(photoFileAccess('play', false, id)).toBeNull();
  });
});
