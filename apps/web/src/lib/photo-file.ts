export const PHOTO_DOWNLOAD_CONTENT_TYPE = 'application/octet-stream';

export type PhotoVariantName = 'thumb' | 'large' | 'full';

export function photoDownloadName(mediaId: string): string {
  return `zdjecie-${mediaId}.jpg`;
}

export type PhotoFileAccess =
  | { mode: 'inline'; variant: PhotoVariantName }
  | {
      mode: 'download';
      variant: 'full';
      downloadName: string;
      responseContentType: typeof PHOTO_DOWNLOAD_CONTENT_TYPE;
    };

/**
 * `dl=1` downloads only the full JPEG. Other variants stay inline so gallery images are not saved.
 * A download request for anything except `full` is refused.
 */
export function photoFileAccess(
  variant: string,
  download: boolean,
  mediaId: string,
): PhotoFileAccess | null {
  if (download) {
    if (variant !== 'full') return null;
    return {
      mode: 'download',
      variant: 'full',
      downloadName: photoDownloadName(mediaId),
      responseContentType: PHOTO_DOWNLOAD_CONTENT_TYPE,
    };
  }
  if (variant !== 'thumb' && variant !== 'large' && variant !== 'full') return null;
  return { mode: 'inline', variant };
}
