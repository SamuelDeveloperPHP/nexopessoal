import type { DocumentKind, DocumentQuality } from '@nexopessoal/domain';

type Dimensions = { width: number; height: number };

function pngDimensions(contents: Buffer): Dimensions | undefined {
  if (contents.length < 24 || contents.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return undefined;
  return { width: contents.readUInt32BE(16), height: contents.readUInt32BE(20) };
}

function jpegDimensions(contents: Buffer): Dimensions | undefined {
  if (contents.length < 4 || contents[0] !== 0xff || contents[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < contents.length) {
    if (contents[offset] !== 0xff) { offset += 1; continue; }
    const marker = contents[offset + 1];
    const length = contents.readUInt16BE(offset + 2);
    if (marker && [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
      return { height: contents.readUInt16BE(offset + 5), width: contents.readUInt16BE(offset + 7) };
    }
    if (length < 2) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

function webpDimensions(contents: Buffer): Dimensions | undefined {
  if (contents.length < 30 || contents.subarray(0, 4).toString('ascii') !== 'RIFF' || contents.subarray(8, 12).toString('ascii') !== 'WEBP') return undefined;
  if (contents.subarray(12, 16).toString('ascii') === 'VP8X') return { width: 1 + contents.readUIntLE(24, 3), height: 1 + contents.readUIntLE(27, 3) };
  return undefined;
}

function imageDimensions(mimeType: string, contents: Buffer): Dimensions | undefined {
  if (mimeType === 'image/png') return pngDimensions(contents);
  if (mimeType === 'image/jpeg') return jpegDimensions(contents);
  if (mimeType === 'image/webp') return webpDimensions(contents);
  return undefined;
}

export function analyzeDocument(mimeType: string, contents: Buffer, documentKind: DocumentKind): Omit<DocumentQuality, 'documentId'> {
  const reasons: string[] = [];
  if (mimeType === 'application/pdf') {
    if (contents.length < 100) reasons.push('PDF muito pequeno para um documento legível.');
    if (!contents.subarray(Math.max(0, contents.length - 1024)).toString('latin1').includes('%%EOF')) reasons.push('PDF sem marcador final válido.');
  } else {
    const dimensions = imageDimensions(mimeType, contents);
    if (!dimensions) reasons.push('Não foi possível ler as dimensões da imagem.');
    else {
      const minimumSide = documentKind === 'profile_photo' ? 240 : 480;
      if (Math.min(dimensions.width, dimensions.height) < minimumSide) reasons.push(`Imagem pequena: mínimo recomendado de ${minimumSide}px no menor lado.`);
    }
  }
  const status = reasons.length === 0 ? 'passed' : 'failed';
  return { status, reasons, analyzedAt: new Date().toISOString(), reviewStatus: status === 'passed' ? 'not_required' : 'pending' };
}
