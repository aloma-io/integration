// workspace-sdk step parser (parseSteps). Plain node:test; run with
// `node --test integration-sdk/test/ws-step-parser.test.mjs`. `yarn test` (tools/run-tests.mjs) also runs it, as a
// standalone script by file name; a failing test makes the node process, and so the run, exit non-zero.
// The .mts source is imported directly; 'jshint' is mapped to an in-test fake by
// helpers/ws-step-parser-hooks.mjs. The last test uses the real jshint only if it resolves.
import {describe, it, test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {register, createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

if (!process.features.typescript) {
  test.skip('ws-step-parser: this Node cannot strip types from .mts (needs Node 22.18 or later)');
} else {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sourceFile = path.resolve(here, '../../workspace-sdk/src/step-parser/index.mts');

  globalThis.__wsStepParserJshint = {calls: []};
  register(new URL('./helpers/ws-step-parser-hooks.mjs', import.meta.url));
  const {default: parseSteps} = await import(pathToFileURL(sourceFile).href);

  const calls = () => globalThis.__wsStepParserJshint.calls;

  // Runs fn(root) inside a fresh temp folder (cwd), restores cwd and removes the folder.
  const inTemp = async (files, fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-step-parser-'));
    const before = process.cwd();
    globalThis.__wsStepParserJshint.calls = [];
    try {
      process.chdir(dir);
      const root = path.join(dir, 'steps');
      for (const [name, text] of Object.entries(files)) {
        const target = path.join(root, name);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.writeFileSync(target, text);
      }
      return await fn(root);
    } finally {
      process.chdir(before);
      fs.rmSync(dir, {recursive: true, force: true});
    }
  };

  const step = (matchBody, doBody, extra = '') =>
    `export const match = () => {${matchBody}};\nexport default async () => {${doBody}};\n${extra}`;
  const simple = step(' return true; ', ' return 1; ');
  const sha = (text) => createHash('sha256').update(text).digest('hex');

  describe('workspace-sdk step parser', () => {
    it('reads only .mjs files, nested too; the name drops .mjs and the path keeps it', async () => {
      const result = await inTemp(
        {
          'one.mjs': simple,
          'sub/two.mjs': simple,
          'sub/deeper/three.mjs': simple,
          'skip.js': simple,
          'notes.txt': 'x',
          'sub/skip.mts': simple,
        },
        (root) => parseSteps(root)
      );
      assert.deepEqual(result.map((r) => r.source.path).sort(), ['one.mjs', 'sub/deeper/three.mjs', 'sub/two.mjs']);
      for (const r of result) {
        assert.equal(r.source.name, r.source.path.replace(/\.mjs$/, ''));
        assert.equal(r.step.name, r.source.name);
        assert.ok(r.source.path.endsWith('.mjs'));
      }
      assert.ok(result.some((r) => r.step.name === 'sub/deeper/three'));
    });

    it('orders the result by path, descending', async () => {
      const result = await inTemp({'a.mjs': simple, 'sub/x.mjs': simple, 'top.mjs': simple}, (root) =>
        parseSteps(root)
      );
      assert.deepEqual(
        result.map((r) => r.source.path),
        ['top.mjs', 'sub/x.mjs', 'a.mjs']
      );
    });

    it('builds content from match and the default function, enabled is the opposite of disabled', async () => {
      const result = await inTemp(
        {
          'on.mjs': step(' return a > 1; ', '\n  await go();\n  return 2;\n'),
          'off.mjs': step(' return true; ', ' return 1; ', 'export const disabled = true;\n'),
          'explicit.mjs': step(' return true; ', ' return 1; ', 'export const disabled = false;\n'),
        },
        (root) => parseSteps(root)
      );
      const by = Object.fromEntries(result.map((r) => [r.step.name, r.step]));
      assert.deepEqual(by.on.content, {
        if: '{return a > 1;}',
        do: 'await go();\n  return 2;',
        enabled: true,
        valid: true,
      });
      assert.equal(by.off.content.enabled, false);
      assert.equal(by.explicit.content.enabled, true);
      assert.equal(by.on.errors, undefined);
    });

    it('hashes the SHA-256 of the returned JSON text of the content', async () => {
      const [r] = await inTemp({'one.mjs': simple}, (root) => parseSteps(root));
      assert.equal(r.step.json, JSON.stringify(r.step.content));
      assert.equal(r.step.hash, sha(r.step.json));
      assert.match(r.step.hash, /^[0-9a-f]{64}$/);
    });

    it('reports validator errors with line numbers reduced by one and other fields kept', async () => {
      const [r] = await inTemp({'bad.mjs': step(' return true; ', ' return 1; /* SYNTAXMARK */ ')}, (root) =>
        parseSteps(root)
      );
      assert.equal(r.step.content.valid, false);
      assert.deepEqual(r.step.errors, [{line: 2, reason: 'bad'}]);
      assert.equal(r.step.json, JSON.stringify(r.step.content));
    });

    it('fails with "do cannot be empty" for an empty body', async () => {
      await inTemp({'empty.mjs': step(' return true; ', '')}, async (root) => {
        await assert.rejects(parseSteps(root), /do cannot be empty/);
      });
    });

    it('fails with "do cannot be empty" for a whitespace-only body', async () => {
      await inTemp({'blank.mjs': step(' return true; ', '  \n\t  \n ')}, async (root) => {
        await assert.rejects(parseSteps(root), /do cannot be empty/);
      });
    });

    it('calls the validator with the options the code sets today', async () => {
      await inTemp({'one.mjs': simple}, (root) => parseSteps(root));
      assert.equal(calls().length, 1);
      assert.deepEqual(calls()[0].options, {
        esversion: 9,
        asi: true,
        eqnull: true,
        '-W032': true,
        '-W083': true,
        '-W119': true,
        '-W014': true,
      });
      assert.ok(calls()[0].source.startsWith('(async () => {'));
      assert.ok(calls()[0].source.includes('return 1;'));
    });

    it('keeps a body with "}" in a string or a nested block whole, and nested functions keep their braces', async () => {
      const body = [
        '',
        '  const s = "a}b{c";',
        '  if (s) {',
        '    const f = function () { return {k: 1}; };',
        '    return f();',
        '  }',
        '',
      ].join('\n');
      const [r] = await inTemp({'nest.mjs': step(' if (x) { return "}"; } ', body)}, (root) => parseSteps(root));
      assert.equal(r.step.content.do, body.trim());
      assert.equal(r.step.content.if, '{if (x) { return "}"; }}');
    });

    it('real jshint (only when it resolves from workspace-sdk)', async (t) => {
      let resolved = null;
      try {
        resolved = createRequire(path.resolve(here, '../../workspace-sdk/package.json')).resolve('jshint');
      } catch {}
      if (!resolved) {
        t.skip('jshint not resolvable');
        return;
      }
      await inTemp({'good.mjs': simple, 'bad.mjs': step(' return true; ', ' var a = 1; var a = 2; ')}, async (root) => {
        const script =
          `import p from ${JSON.stringify(pathToFileURL(sourceFile).href)};` +
          `const r = await p(${JSON.stringify(root)});` +
          `console.log(JSON.stringify(r.map(x => [x.step.name, x.step.content.valid])));`;
        const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8'});
        assert.equal(out.status, 0, out.stderr);
        const line = out.stdout.trim().split('\n').pop();
        assert.deepEqual(JSON.parse(line), [
          ['good', true],
          ['bad', false],
        ].sort((a, b) => (a[0] > b[0] ? -1 : 1)));
      });
    });
  });
}
