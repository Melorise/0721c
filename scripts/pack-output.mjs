import assert from 'node:assert/strict';

/** npm 11 reports an array; npm 12 reports an object keyed by package name. */
export function parsePackOutput(stdout, name) {
  const output = JSON.parse(stdout);
  const packed = Array.isArray(output) ? output[0] : output?.[name];
  assert.ok(packed, `npm pack did not return metadata for ${name}`);
  return packed;
}
