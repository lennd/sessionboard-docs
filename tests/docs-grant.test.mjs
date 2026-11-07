import test from 'node:test';
import assert from 'node:assert/strict';
import { docsGrantLine, normalizeDocsGrant } from '../src/lib/docs-grant.mjs';

test('the account menu line names the end date', () => {
  assert.equal(
    docsGrantLine({ products: ['marketing'], api_docs: true, expires_at: '2027-02-05T23:59:59.000Z' }),
    'Access granted by Sessionboard until February 5, 2027',
  );
});

test('no grant, or a malformed one, gives no line', () => {
  assert.equal(docsGrantLine(null), null);
  assert.equal(docsGrantLine({ expires_at: 'soon' }), null);
});

test('normalizes to the fields page script needs', () => {
  assert.deepEqual(
    normalizeDocsGrant({ granted_by: 'sessionboard', products: ['awards', 7], api_docs: 'yes', expires_at: '2027-01-01' }),
    { products: ['awards'], api_docs: false, expires_at: '2027-01-01T00:00:00.000Z' },
  );
});
