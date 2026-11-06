// The package declares no executable named "aloma"; that name belongs to the ALOMA CLI (@aloma.io/aloma).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const bin = typeof pkg.bin === 'string' ? {[pkg.name.split('/').pop()]: pkg.bin} : pkg.bin || {};

describe('package bin names', () => {
  it('no bin is named "aloma"', () => {
    assert.ok(!Object.keys(bin).includes('aloma'), `bins: ${Object.keys(bin).join(', ')}`);
  });

  it('declares a bin for npx that points at build/cli.mjs', () => {
    assert.ok(Object.keys(bin).length > 0);
    assert.ok(Object.values(bin).every((p) => p === './build/cli.mjs'));
  });

  it('the workspace template calls the CLI by path', () => {
    const template = fs.readFileSync(path.join(root, 'template/workspace/package.json'), 'utf8');
    assert.ok(template.includes('node_modules/@aloma.io/workspace-sdk/build/cli.mjs'));
  });
});
