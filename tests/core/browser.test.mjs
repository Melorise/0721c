import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';

test('core executes in a browser-like realm with no Node globals, frameworks or dependencies', () => {
  const run = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(new URL('./browser-fixture.mjs', import.meta.url))], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr || run.error?.message);
  assert.match(run.stdout, /Node globals absent; direct article and protocol roundtrip passed/);
});

test('all current schemas are parseable, restrict unknown fields and contain resolvable local references', async () => {
  const directory = new URL('../../schemas/', import.meta.url);
  const names = (await readdir(directory)).filter(name => name.endsWith('.schema.json'));
  assert.equal(names.length, 5);
  for (const name of names) {
    const schema = JSON.parse(await readFile(new URL(name, directory), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.additionalProperties, false);
    const pending = [schema];
    while (pending.length) {
      const item = pending.pop();
      if (!item || typeof item !== 'object') continue;
      if (item.pattern) assert.doesNotThrow(() => new RegExp(item.pattern, 'u'), `${name}: ${item.pattern}`);
      if (item.$ref) {
        assert.ok(item.$ref.startsWith('#/'), 'Schema references must be locally resolvable');
        let target = schema;
        for (const piece of item.$ref.slice(2).split('/')) target = target?.[piece.replace(/~1/g, '/').replace(/~0/g, '~')];
        assert.ok(target, `${name}: ${item.$ref}`);
      }
      pending.push(...Object.values(item));
    }
  }
});
