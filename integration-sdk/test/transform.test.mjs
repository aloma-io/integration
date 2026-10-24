// The transform reads a connector's controller source and returns the method declarations (`text`) and names
// (`methods`) that `cli build` writes to build/.controller.json. It replaced @ts-ast-parser/core (engines stop at
// Node 20), so most cases below are PARITY cases: expected.json was produced by the previous implementation (the
// ts-ast-parser one, SDK 3.8.68) on the same source, and the new one must print exactly the same. The same check
// ran on 58 real connector controllers (all of aloma-io/connector-*) with no difference.
// Needs `yarn build` first. Offline.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it} from 'mocha';
import transform from '../build/transform/index.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transform');

// the transform reads tsconfig.json from the working directory, as `cli build` runs it from the connector folder
const run = async (name) => {
  const before = process.cwd();
  process.chdir(path.join(fixtures, name));
  try {
    return await transform('./src/controller/index.mts');
  } finally {
    process.chdir(before);
  }
};

const expected = (name) => JSON.parse(fs.readFileSync(path.join(fixtures, name, 'expected.json'), 'utf8'));

describe('transform (controller source to declarations)', function () {
  this.timeout(60000);

  for (const [name, what] of [
    ['basic', 'JSDoc description, @param, @example, @namespace, defaults, return types'],
    ['visibility', 'public, private, protected, static, underscore, quoted names, arrow property, getter, inherited'],
    ['typed', 'typed object parameters, unions, arrays, tuples, optional'],
    ['overloads', 'one declaration per overload signature'],
    ['tdd-stub', 'the real connector-tdd-stub controller'],
  ]) {
    it(`prints exactly what the previous implementation printed: ${name} (${what})`, async () => {
      assert.deepEqual(await run(name), expected(name));
    });
  }

  it('lists the public methods the class declares or overrides, not inherited, private, static or underscore ones', async () => {
    const {methods} = await run('visibility');
    assert.deepEqual(methods, ['visible', 'quoted-name', 'arrow', 'inheritedPublic']);
  });

  it('lists the properties of a parameter typed with an interface (the previous implementation crashed)', async () => {
    const {text, methods} = await run('interface-param');
    assert.deepEqual(methods, ['viaInterface']);
    assert.match(text, /declare function viaInterface\(\{id; n\}: \{/);
    assert.match(text, /\n id: string; /);
    assert.match(text, /\n n: number \| undefined\}\): \{ id: string; n: number \| undefined; \};/);
  });

  it('fails when the file exports more than the default class', async () => {
    await assert.rejects(run('two-exports'), /connector file needs to export default class/);
  });

  it('fails with the TypeScript error text when the source does not compile (the previous one died on a circular JSON error)', async () => {
    await assert.rejects(run('type-error'), (err) => {
      assert.match(err.message, /has TypeScript errors/);
      assert.match(err.message, /index\.mts\(5,5\).*TS2322.*'string' is not assignable to type 'number'/);
      return true;
    });
  });
});
