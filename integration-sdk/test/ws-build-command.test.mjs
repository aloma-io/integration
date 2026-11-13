// Regression: the workspace-sdk `build` command.
// Plain node:test file (run with `node --test`; not wired into any package's yarn test by this file).
// `yarn` is a fake script first on PATH; the step parser is an in-test fake (see helpers/ws-build-hooks.mjs).
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {register} from 'node:module';

if (!process.features.typescript) {
  console.log('SKIP ws-build-command: this Node cannot strip types from .mts files (needs Node 22.18 or later)');
} else {
  register('./helpers/ws-build-hooks.mjs', import.meta.url);
  const {build} = await import('../../workspace-sdk/src/commands/build.mts');

  const run = async (steps, {yarnExit = 0, makeExport = false} = {}) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-build-'));
    const bin = path.join(tmp, 'bin');
    const work = path.join(tmp, 'work');
    const log = path.join(tmp, 'yarn.log');
    fs.mkdirSync(bin);
    fs.mkdirSync(work);
    fs.writeFileSync(
      path.join(bin, 'yarn'),
      `#!/bin/sh\necho "$@ @ $PWD" >> "${log}"\nexit ${yarnExit}\n`,
      {mode: 0o755},
    );
    if (makeExport) fs.mkdirSync(path.join(work, 'export'));

    const oldCwd = process.cwd();
    const oldPath = process.env.PATH;
    const oldLog = console.log;
    const lines = [];
    globalThis.__wsBuildSteps = steps;
    globalThis.__wsBuildParseDirs = [];
    try {
      process.chdir(work);
      const realWork = process.cwd();
      process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
      console.log = (...a) => lines.push(a.join(' '));
      let result;
      let error;
      try {
        result = await build();
      } catch (e) {
        error = e;
      }
      console.log = oldLog;
      const stepsDir = path.join(realWork, 'export', 'steps');
      return {
        result,
        error,
        lines,
        realWork,
        yarnLog: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [],
        hasExport: fs.existsSync(path.join(realWork, 'export')),
        files: fs.existsSync(stepsDir) ? fs.readdirSync(stepsDir).sort() : null,
        contents: Object.fromEntries(
          (fs.existsSync(stepsDir) ? fs.readdirSync(stepsDir) : []).map((f) => [f, fs.readFileSync(path.join(stepsDir, f), 'utf8')]),
        ),
        parseDirs: globalThis.__wsBuildParseDirs,
      };
    } finally {
      console.log = oldLog;
      process.env.PATH = oldPath;
      process.chdir(oldCwd);
      delete globalThis.__wsBuildSteps;
      delete globalThis.__wsBuildParseDirs;
      fs.rmSync(tmp, {recursive: true, force: true});
    }
  };

  const item = (name, errors) => ({source: {file: `${name}.mjs`}, step: {name, errors, content: `body of ${name}`}});

  describe('workspace-sdk build command', () => {
    it('runs yarn run tsc once in the current folder', async () => {
      const r = await run([item('one')]);
      assert.equal(r.error, undefined);
      assert.equal(r.yarnLog.length, 1);
      assert.match(r.yarnLog[0], /^run tsc @ /);
      assert.ok(r.yarnLog[0].endsWith(` @ ${r.realWork}`));
    });

    it('reads the steps from build/steps/ under the current folder', async () => {
      const r = await run([]);
      assert.deepEqual(r.parseDirs, [`${r.realWork}/build/steps/`]);
    });

    it('a failing yarn makes build reject and writes no export folder', async () => {
      const r = await run([item('one')], {yarnExit: 1});
      assert.ok(r.error, 'build should reject');
      assert.equal(r.hasExport, false);
      assert.deepEqual(r.parseDirs, []);
    });

    it('creates export/steps and writes one file per step with the JSON of the step', async () => {
      const steps = [item('first'), item('second')];
      const r = await run(steps);
      assert.deepEqual(r.files, ['first.step.json', 'second.step.json']);
      assert.equal(r.contents['first.step.json'], JSON.stringify(steps[0].step));
      assert.equal(r.contents['second.step.json'], JSON.stringify(steps[1].step));
    });

    it('works when export/ exists already', async () => {
      const r = await run([item('one')], {makeExport: true});
      assert.equal(r.error, undefined);
      assert.deepEqual(r.files, ['one.step.json']);
    });

    it('slashes and spaces in a step name become "__" in the file name', async () => {
      const r = await run([item('a/b c')]);
      assert.deepEqual(r.files, ['a__b__c.step.json']);
      assert.equal(JSON.parse(r.contents['a__b__c.step.json']).name, 'a/b c');
    });

    it('prints [OK] for a step without errors and ends with OK. returning false', async () => {
      const r = await run([item('good')]);
      assert.ok(r.lines.includes('[OK]\tgood'));
      assert.equal(r.lines.at(-1), 'OK.');
      assert.equal(r.result, false);
    });

    it('prints [ERR] for a step with errors and ends with ERROR. returning true', async () => {
      const r = await run([item('bad', ['broken'])]);
      assert.ok(r.lines.includes('[ERR]\tbad'));
      assert.equal(r.lines.at(-1), 'ERROR.');
      assert.equal(r.result, true);
    });

    it('a step with errors is still written and the other steps are written and reported too', async () => {
      const r = await run([item('before'), item('bad', ['broken']), item('after')]);
      assert.deepEqual(r.files, ['after.step.json', 'bad.step.json', 'before.step.json']);
      assert.deepEqual(
        r.lines.filter((l) => l.startsWith('[')),
        ['[OK]\tbefore', '[ERR]\tbad', '[OK]\tafter'],
      );
      assert.equal(r.lines.at(-1), 'ERROR.');
      assert.equal(r.result, true);
    });

    it('with no steps writes nothing under export/steps, prints OK. and returns false', async () => {
      const r = await run([]);
      assert.deepEqual(r.files, []);
      assert.equal(r.lines.at(-1), 'OK.');
      assert.equal(r.lines.some((l) => l.startsWith('[')), false);
      assert.equal(r.result, false);
    });
  });
}
