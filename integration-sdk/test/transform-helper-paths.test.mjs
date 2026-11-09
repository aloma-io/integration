// Two paths of the controller transform that the fixtures in transform.test.mjs do not reach: the file-name callback
// of the TypeScript error formatter (reached when the controller file is given by an absolute path) and the parameter
// reader used when a method declares a `this` parameter in front of its destructured parameter.
// Needs `yarn build` first. Offline.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, it} from 'mocha';
import transform from '../build/transform/index.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transform');

const inFixture = async (name, file) => {
  const before = process.cwd();
  process.chdir(path.join(fixtures, name));
  try {
    return await transform(file);
  } finally {
    process.chdir(before);
  }
};

describe('transform (helper paths)', function () {
  this.timeout(60000);

  it('names the failing file relative to the working directory when the file is given by an absolute path', async () => {
    const absolute = path.join(fixtures, 'type-error', 'src', 'controller', 'index.mts');
    await assert.rejects(inFixture('type-error', absolute), (err) => {
      assert.ok(err.message.startsWith(`${absolute} has TypeScript errors:\n`), err.message);
      assert.match(err.message, /\nsrc\/controller\/index\.mts\(5,5\): error TS2322: Type 'string' is not assignable to type 'number'\./);
      return true;
    });
  });

  it('prints a destructured parameter that follows a this parameter, with its type', async () => {
    const {text, methods} = await inFixture('this-param', './src/controller/index.mts');
    assert.deepEqual(methods, ['withThis']);
    assert.match(text, /declare function withThis\(\{id\}: \{\n\/\*\*\n\n \*\/\n id: string\}\): string;/);
  });
});
