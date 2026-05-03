/**
 * SALE.SIGNED_QR_CODE / signed_Qr_code → data URL for <img src>.
 * Accepts raw base64, URL-safe base64, data URLs, hex (binary), URLs, inline SVG, or JSON-wrapped values.
 */

function toStandardBase64(s) {
  let t = String(s).replace(/\r?\n|\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = t.length % 4;
  if (pad) t += '='.repeat(4 - pad);
  return t;
}

function stripBase64Payload(s) {
  return s.replace(/^data:[^;]+;base64,/i, '').trim();
}

function buildQrFromTextUrl(text) {
  const payload = String(text || '').trim();
  if (!payload) return null;
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}`;
}

function imageDataUrlFromBase64IfValid(input) {
  let b64 = stripBase64Payload(String(input || ''));
  b64 = toStandardBase64(b64);
  if (!b64 || b64.length < 16 || typeof atob !== 'function') return null;
  try {
    const bin = atob(b64.slice(0, 64));
    if (!bin || bin.length < 4) return null;
    const c0 = bin.charCodeAt(0);
    const c1 = bin.charCodeAt(1);
    const c2 = bin.charCodeAt(2);
    const c3 = bin.charCodeAt(3);
    let mime = null;
    if (c0 === 0x89 && c1 === 0x50 && c2 === 0x4e && c3 === 0x47) mime = 'image/png';
    else if (c0 === 0xff && c1 === 0xd8 && c2 === 0xff) mime = 'image/jpeg';
    else if (c0 === 0x47 && c1 === 0x49 && c2 === 0x46 && c3 === 0x38) mime = 'image/gif';
    else if (bin.startsWith('RIFF') && bin.includes('WEBP')) mime = 'image/webp';
    else if (bin.trimStart().startsWith('<svg')) mime = 'image/svg+xml';
    if (!mime) return null;
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

function tryHexToDataUrl(s) {
  const hex = s.replace(/\s/g, '');
  if (hex.length < 32 || hex.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  try {
    if (typeof Buffer !== 'undefined') {
      return `data:image/png;base64,${Buffer.from(hex, 'hex').toString('base64')}`;
    }
  } catch {
    return null;
  }
  return null;
}

function unwrapJsonString(s) {
  const t = s.trim();
  if (!t.startsWith('{')) return s;
  try {
    const o = JSON.parse(t);
    if (o && typeof o === 'object') {
      const inner =
        o.data ??
        o.qr ??
        o.QR ??
        o.signed_qr_code ??
        o.SIGNED_QR_CODE ??
        o.signed_Qr_code ??
        o.image ??
        o.img;
      if (typeof inner === 'string' && inner.trim()) return inner.trim();
    }
  } catch {
    /* ignore */
  }
  return s;
}

/**
 * Oracle may return raw image bytes in a JS string (Latin-1 / VARCHAR2 / BLOB read as string).
 * Detect PNG / JPEG / GIF magic.
 */
function tryLatin1BinaryImageToDataUrl(s) {
  if (typeof s !== 'string' || s.length < 24) return null;
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
  let mime = null;
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) mime = 'image/png';
  else if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) mime = 'image/jpeg';
  else if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38) mime = 'image/gif';
  if (!mime || typeof btoa !== 'function') return null;
  const chunk = 8192;
  let binary = '';
  for (let i = 0; i < u8.length; i += chunk) {
    const sub = u8.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function bufferJsonToDataUrl(raw) {
  if (!raw || typeof raw !== 'object' || raw.type !== 'Buffer' || !Array.isArray(raw.data)) return null;
  try {
    const u8 = new Uint8Array(raw.data);
    if (u8.length < 4) return null;
    let mime = 'image/png';
    if (u8[0] === 0xff && u8[1] === 0xd8) mime = 'image/jpeg';
    else if (u8[0] === 0x47 && u8[1] === 0x49) mime = 'image/gif';
    else if (u8[0] !== 0x89) mime = 'application/octet-stream';
    const chunk = 8192;
    let binary = '';
    for (let i = 0; i < u8.length; i += chunk) {
      const sub = u8.subarray(i, i + chunk);
      binary += String.fromCharCode.apply(null, sub);
    }
    if (typeof btoa !== 'function') return null;
    return `data:${mime};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

/**
 * Turn a data:image/...;base64 URL into a blob: URL (avoids broken <img> on very long data URLs).
 * Caller must URL.revokeObjectURL when done.
 */
export function dataUrlToObjectUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = /^data:([^;]+);base64,(.*)$/is.exec(dataUrl.trim());
  if (!m) return null;
  const mime = m[1].trim() || 'image/png';
  let b64 = m[2].replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad) b64 += '='.repeat(4 - pad);
  try {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return null;
  }
}

export function signedQrCodeToDataUrl(raw) {
  if (raw == null || raw === '') return null;
  const fromBufJson = bufferJsonToDataUrl(raw);
  if (fromBufJson) return fromBufJson;
  if (typeof raw === 'string') {
    const latin = tryLatin1BinaryImageToDataUrl(raw);
    if (latin) return latin;
  }
  if (typeof raw === 'object' && raw !== null && Array.isArray(raw.data)) {
    try {
      const u8 = new Uint8Array(raw.data);
      let bin = '';
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      const b64 = typeof btoa === 'function' ? btoa(bin) : '';
      if (b64) return `data:image/png;base64,${b64}`;
    } catch {
      return null;
    }
    return null;
  }
  let s = String(raw).trim();
  if (!s) return null;
  if (/%[0-9a-fA-F]{2}/.test(s)) {
    try {
      const dec = decodeURIComponent(s);
      if (dec && dec !== s) s = dec.trim();
    } catch {
      /* keep s */
    }
  }
  s = unwrapJsonString(s);
  if (!s) return null;

  const latin2 = typeof s === 'string' ? tryLatin1BinaryImageToDataUrl(s) : null;
  if (latin2) return latin2;

  if (/^https?:\/\//i.test(s)) return s;

  if (s.startsWith('data:')) return s;
  if (s.startsWith('<svg')) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;

  const hexUrl = tryHexToDataUrl(s);
  if (hexUrl) return hexUrl;

  const imageUrl = imageDataUrlFromBase64IfValid(s);
  if (imageUrl) return imageUrl;

  // Final fallback: signed QR is payload text, so render QR from that raw value.
  return buildQrFromTextUrl(s);
}
