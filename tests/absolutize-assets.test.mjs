/**
 * The index is consumed off-origin, so a relative asset URL in it is a broken
 * image somewhere else. These cases are the ones that actually appear in the
 * corpus (1,200 root-relative `/images/kb/*` screenshots), plus the two things
 * this transform must NOT touch.
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { absolutizeAssets } from '../src/lib/absolutize-assets.mjs';

const HOST = 'learn.sessionboard.com';
const run = html => absolutizeAssets(html, HOST);

describe('absolutizeAssets', () => {
  test('rewrites a root-relative image', () => {
    assert.equal(
      run('<img src="/images/kb/a.png" alt="A">'),
      '<img src="https://learn.sessionboard.com/images/kb/a.png" alt="A">',
    );
  });

  test('leaves an already-absolute URL alone', () => {
    const html = '<img src="https://cdn.example.com/a.png">';
    assert.equal(run(html), html);
  });

  test('leaves a protocol-relative URL alone', () => {
    const html = '<img src="//cdn.example.com/a.png">';
    assert.equal(run(html), html);
  });

  test('rewrites every candidate in a srcset, keeping descriptors', () => {
    assert.equal(
      run('<img srcset="/a.png 1x, /b.png 2x" src="/a.png">'),
      '<img srcset="https://learn.sessionboard.com/a.png 1x, ' +
        'https://learn.sessionboard.com/b.png 2x" ' +
        'src="https://learn.sessionboard.com/a.png">',
    );
  });

  test('rewrites source and video poster', () => {
    assert.equal(
      run('<video poster="/p.jpg"><source src="/v.mp4"></video>'),
      '<video poster="https://learn.sessionboard.com/p.jpg">' +
        '<source src="https://learn.sessionboard.com/v.mp4"></video>',
    );
  });

  test('does NOT touch anchor hrefs — the reader navigates those in-app', () => {
    const html = '<a href="/sessions/accept-decline">Accept or decline</a>';
    assert.equal(run(html), html);
  });

  test('does NOT touch the app: hrefs the rehype plugin produced', () => {
    const html = '<a data-sb-route="/event/:eventId/sessions">Sessions</a>';
    assert.equal(run(html), html);
  });

  test('preserves surrounding markup and marker attributes', () => {
    assert.equal(
      run('<div data-sb-if-feature="awards"><img src="/a.png" loading="lazy"></div>'),
      '<div data-sb-if-feature="awards">' +
        '<img src="https://learn.sessionboard.com/a.png" loading="lazy"></div>',
    );
  });

  test('is a no-op without a host, rather than emitting https://undefined', () => {
    const html = '<img src="/a.png">';
    assert.equal(absolutizeAssets(html, ''), html);
  });
});
