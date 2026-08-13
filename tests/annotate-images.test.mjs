/**
 * The reader renders these images in a 380px panel, so wrong dimensions are worse
 * than none: they would lock in the wrong aspect ratio for a screenshot. Hence the
 * real-header cases below rather than a stubbed size function alone.
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { deflateSync } from 'node:zlib';

import { annotateImages, imageSize } from '../src/lib/annotate-images.mjs';

/** Minimal but genuine PNG header: signature + IHDR with width/height. */
function png(width, height) {
  const buf = Buffer.alloc(24);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(0x0d0a1a0a, 4);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function gif(width, height) {
  const buf = Buffer.alloc(13);
  buf.write('GIF89a', 0, 'ascii');
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

/** JPEG with a comment segment before SOF0, so the marker walk has to work. */
function jpeg(width, height) {
  const comment = Buffer.alloc(6);
  comment.writeUInt16BE(0xfffe, 0); // COM
  comment.writeUInt16BE(4, 2);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(8, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), comment, sof]);
}

function webpVp8x(width, height) {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
}

describe('imageSize', () => {
  test('reads PNG', () => {
    assert.deepEqual(imageSize(png(1280, 720)), { width: 1280, height: 720 });
  });

  test('reads GIF', () => {
    assert.deepEqual(imageSize(gif(320, 240)), { width: 320, height: 240 });
  });

  test('reads JPEG past an earlier segment', () => {
    assert.deepEqual(imageSize(jpeg(800, 600)), { width: 800, height: 600 });
  });

  test('reads WebP VP8X', () => {
    assert.deepEqual(imageSize(webpVp8x(1000, 500)), { width: 1000, height: 500 });
  });

  test('returns null for something that is not an image', () => {
    assert.equal(imageSize(deflateSync(Buffer.from('not an image at all'))), null);
  });

  test('returns null rather than guessing on a truncated file', () => {
    assert.equal(imageSize(Buffer.from([0x89, 0x50])), null);
  });
});

describe('annotateImages', () => {
  const sizeOf = (src) => (src.endsWith('/known.png') ? { width: 640, height: 480 } : null);
  const run = (html) => annotateImages(html, sizeOf);

  test('adds lazy loading, async decoding and intrinsic dimensions', () => {
    assert.equal(
      run('<img src="https://learn.sessionboard.com/known.png" alt="A">'),
      '<img src="https://learn.sessionboard.com/known.png" alt="A" ' +
        'loading="lazy" decoding="async" width="640" height="480">',
    );
  });

  test('adds the hints even when the size is unknown', () => {
    assert.equal(
      run('<img src="/unknown.png">'),
      '<img src="/unknown.png" loading="lazy" decoding="async">',
    );
  });

  test('leaves an explicit loading hint alone', () => {
    assert.equal(
      run('<img src="/unknown.png" loading="eager">'),
      '<img src="/unknown.png" loading="eager" decoding="async">',
    );
  });

  test('does not second-guess dimensions the author set', () => {
    assert.equal(
      run('<img src="https://learn.sessionboard.com/known.png" width="200">'),
      '<img src="https://learn.sessionboard.com/known.png" width="200" ' +
        'loading="lazy" decoding="async">',
    );
  });

  test('ignores an img with no src', () => {
    assert.equal(run('<img alt="broken">'), '<img alt="broken">');
  });

  test('leaves other tags untouched', () => {
    const html = '<p>Text</p><video poster="/known.png"></video>';
    assert.equal(run(html), html);
  });
});
