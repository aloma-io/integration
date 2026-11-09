// notEmpty (internal/util) and the descriptor errors of Builder.build: a build/.controller.json without a connector id
// or a version. Standalone script (no mocha). The descriptor is read from ./build/.controller.json under the working
// directory, so each case runs in its own temporary folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {notEmpty} from '../build/internal/util/index.mjs';
import {Builder} from '../build/builder/index.mjs';
import {assert, assertEqual, outcome, suite} from './helpers/flow-kit.mjs';

const {test, finish} = suite('notEmpty and Builder');

/** builds in a temporary folder holding a descriptor with the given content; resolves with the outcome of build() */
const buildWith = async (descriptor) => {
  const before = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-'));
  fs.mkdirSync(path.join(dir, 'build'));
  fs.writeFileSync(path.join(dir, 'build', '.controller.json'), JSON.stringify(descriptor));
  process.chdir(dir);
  try {
    return await outcome(new Builder().build());
  } finally {
    process.chdir(before);
    fs.rmSync(dir, {recursive: true, force: true});
  }
};

await test('notEmpty returns the text it is given', () => {
  assertEqual(notEmpty('abc', 'name'), 'abc');
});

await test('notEmpty returns the text with its surrounding spaces kept', () => {
  assertEqual(notEmpty('  abc ', 'name'), '  abc ');
});

await test('notEmpty throws "<name> cannot be empty" for an empty string', () => {
  let message;
  try {
    notEmpty('', 'source');
  } catch (e) {
    message = e.message;
  }
  assertEqual(message, 'source cannot be empty');
});

await test('notEmpty throws for a string of spaces, undefined and null', () => {
  for (const value of ['   ', '\n\t', undefined, null]) {
    let message;
    try {
      notEmpty(value, 'field');
    } catch (e) {
      message = e.message;
    }
    assertEqual(message, 'field cannot be empty', `message for ${JSON.stringify(value)}`);
  }
});

await test('notEmpty throws a TypeError for a number (it has no trim)', () => {
  let error;
  try {
    notEmpty(5, 'n');
  } catch (e) {
    error = e;
  }
  assert(error instanceof TypeError, `expected a TypeError, got ${error}`);
});

await test('build rejects with "id cannot be empty" when the descriptor has no connectorId', async () => {
  const {error} = await buildWith({text: '', methods: [], version: '1.0.0'});
  assert(error, 'build should reject');
  assertEqual(error.message, 'id cannot be empty');
});

await test('build rejects with "id cannot be empty" when the connectorId is blank', async () => {
  const {error} = await buildWith({text: '', methods: [], connectorId: '  ', version: '1.0.0'});
  assert(error, 'build should reject');
  assertEqual(error.message, 'id cannot be empty');
});

await test('build rejects with "version cannot be empty" when the descriptor has no version', async () => {
  const {error} = await buildWith({text: '', methods: [], connectorId: 'my-connector'});
  assert(error, 'build should reject');
  assertEqual(error.message, 'version cannot be empty');
});

await test('build rejects with "version cannot be empty" when the version is empty', async () => {
  const {error} = await buildWith({text: '', methods: [], connectorId: 'my-connector', version: ''});
  assert(error, 'build should reject');
  assertEqual(error.message, 'version cannot be empty');
});

await test('build reports the missing id before the missing version', async () => {
  const {error} = await buildWith({text: '', methods: []});
  assertEqual(error.message, 'id cannot be empty');
});

finish();
