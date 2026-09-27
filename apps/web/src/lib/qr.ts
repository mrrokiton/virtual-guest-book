import QRCode from 'qrcode';

export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#2b2320', light: '#ffffff' },
  });
}

export function qrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { type: 'png', width: 1200, margin: 2, errorCorrectionLevel: 'M' });
}
