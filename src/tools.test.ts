import assert from "node:assert/strict";
import { test } from "node:test";
import { revisionOf, sameRevision } from "./tools.ts";

const HEX = "a054".repeat(16);

test("revisionOf: strips the quotation marks of a strong ETag, leaves the rest alone", () => {
  assert.equal(revisionOf(`"sha256:${HEX}"`), `sha256:${HEX}`);
  assert.equal(revisionOf(`sha256:${HEX}`), `sha256:${HEX}`);
  assert.equal(revisionOf(`W/"sha256:${HEX}"`), `W/"sha256:${HEX}"`);
  assert.equal(revisionOf(null), null);
});

test("sameRevision: with or without the quotation marks", () => {
  const etag = `"sha256:${HEX}"`;
  assert.equal(sameRevision(etag, `sha256:${HEX}`), true);
  assert.equal(sameRevision(etag, etag), true);
  assert.equal(sameRevision(etag, ` sha256:${HEX} `), true);
});

test("sameRevision: a stale or different value is not the same", () => {
  const etag = `"sha256:${HEX}"`;
  assert.equal(sameRevision(etag, "sha256:0000"), false);
  assert.equal(sameRevision(etag, `"sha256:0000"`), false);
  assert.equal(sameRevision(etag, HEX), false);
  assert.equal(sameRevision(etag, `"sha256:${HEX}`), false);
});

test("sameRevision: a weak ETag or none is never the same", () => {
  assert.equal(sameRevision(`W/"sha256:${HEX}"`, `W/"sha256:${HEX}"`), false);
  assert.equal(sameRevision(`W/"sha256:${HEX}"`, `sha256:${HEX}`), false);
  assert.equal(sameRevision(null, `sha256:${HEX}`), false);
});
