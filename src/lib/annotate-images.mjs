/**
 * Give every article image intrinsic dimensions and defer the ones off screen.
 *
 * Both matter more in the in-app reader than they do here. An article like
 * /portals/collect-documents carries 29 full-size screenshots: rendered in a
 * 380px panel with no width or height, the browser reserves no space for any of
 * them, so the text reflows 29 times as they arrive — and a reader opened at an
 * anchor lands on the right heading, then watches it slide off screen as images
 * above it resolve. Deferring the off-screen ones also stops opening one article
 * from pulling several megabytes it may never show.
 *
 * Dimensions are read from the file bytes rather than trusted from markup,
 * because the corpus is imported screenshots that carry no dimensions at all.
 * The reader is responsible for the CSS that keeps them responsive
 * (`prose` gives `max-width: 100%; height: auto`), so the attributes only supply
 * the aspect ratio.
 */

const IMG_TAG = /<img\b([^>]*)>/gi;
const SRC_ATTR = /\bsrc=(["'])(.*?)\1/i;
const HAS_ATTR = name => new RegExp(`\\b${name}=`, 'i');

/** PNG: IHDR width/height are big-endian uint32s at bytes 16 and 20. */
function pngSize(buf) {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** GIF: logical screen width/height are little-endian uint16s at bytes 6 and 8. */
function gifSize(buf) {
  if (buf.length < 10 || buf.toString('ascii', 0, 3) !== 'GIF') return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

/** JPEG: walk the segment markers to the first SOFn, which carries the size. */
function jpegSize(buf) {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    // SOF0-SOF3, SOF5-SOF7, SOF9-SOF11, SOF13-SOF15 all start with height/width;
    // DHT (c4), JPG (c8) and DAC (cc) sit in the same range and do not.
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      return {
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + buf.readUInt16BE(offset + 2);
  }
  return null;
}

/** WebP (VP8X/VP8L/VP8 lossy), whose three sub-formats store size differently. */
function webpSize(buf) {
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buf.toString('ascii', 8, 12) !== 'WEBP') return null;

  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      width: 1 + buf.readUIntLE(24, 3),
      height: 1 + buf.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
    };
  }
  if (chunk === 'VP8 ') {
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

/**
 * Intrinsic size of an encoded image, or null when the format is not one of the
 * four in the corpus. Null is always safe: the image renders as it does today.
 */
export function imageSize(buf) {
  if (!buf || buf.length < 10) return null;
  const size =
    pngSize(buf) ?? gifSize(buf) ?? webpSize(buf) ?? jpegSize(buf) ?? null;
  if (!size || !size.width || !size.height) return null;
  return size;
}

/**
 * @param {string} html - article HTML, assets already absolutized
 * @param {(src: string) => {width: number, height: number} | null} sizeOf
 *   Resolves an image URL to its intrinsic size. Injected so this is testable
 *   without a build directory, and so a missing file is the caller's problem.
 * @returns {string}
 */
export function annotateImages(html, sizeOf) {
  if (!html) return html;

  return html.replace(IMG_TAG, (tag, attrs) => {
    const src = attrs.match(SRC_ATTR)?.[2];
    if (!src) return tag;

    let extra = '';
    // Author intent wins: the handful of images with explicit dimensions or an
    // eager hint were set that way deliberately.
    if (!HAS_ATTR('loading').test(attrs)) extra += ' loading="lazy"';
    if (!HAS_ATTR('decoding').test(attrs)) extra += ' decoding="async"';

    if (!HAS_ATTR('width').test(attrs) && !HAS_ATTR('height').test(attrs)) {
      const size = sizeOf(src);
      if (size) extra += ` width="${size.width}" height="${size.height}"`;
    }

    return `<img${attrs}${extra}>`;
  });
}
