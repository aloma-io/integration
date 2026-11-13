// Regression: the workspace-sdk `create` command, run from source.
// Plain node:test file (run with `node --test`, not wired into workspace-sdk's yarn test).
// `create` imports only node: modules, so nothing needs faking except `yarn`:
// a fake yarn script first on PATH appends its arguments and working folder to a log.
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wsRoot = path.resolve(here, '../../workspace-sdk');
const templateRoot = path.join(wsRoot, 'template/workspace');
const createUrl = pathToFileURL(path.join(wsRoot, 'src/commands/create.mts')).href;

if (!process.features.typescript) {
  console.log('SKIP ws-create-command: this Node cannot run .mts files directly (process.features.typescript is not true)');
} else {
  const {create} = await import(createUrl);

  const FILES = ['src/steps/and-done/greeting done.mts', 'src/steps/hello world.mts', 'package.json', 'tsconfig.json'];

  // Fake yarn: logs "<args>|<working folder>" per call; fails when FAKE_YARN_FAIL names the call
  // ("install" for a bare `yarn`, otherwise the first argument).
  const FAKE_YARN = `#!/bin/sh
echo "$*|$(pwd -P)" >> "$FAKE_YARN_LOG"
if [ -n "$FAKE_YARN_FAIL" ] && [ "$FAKE_YARN_FAIL" = "\${1:-install}" ]; then exit 1; fi
exit 0
`;

  const listFiles = (dir, base = dir) =>
    fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p)];
    });

  // Runs fn in a fresh temp folder with the fake yarn on PATH; restores everything afterwards.
  const sandbox = async (fn, env = {}) => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-create-')));
    const bin = path.join(root, 'bin');
    const work = path.join(root, 'work');
    fs.mkdirSync(bin);
    fs.mkdirSync(work);
    fs.writeFileSync(path.join(bin, 'yarn'), FAKE_YARN, {mode: 0o755});
    const log = path.join(root, 'yarn.log');
    const oldCwd = process.cwd();
    const oldEnv = {PATH: process.env.PATH, FAKE_YARN_LOG: process.env.FAKE_YARN_LOG, FAKE_YARN_FAIL: process.env.FAKE_YARN_FAIL};
    const oldLog = console.log;
    const out = [];
    console.log = (...a) => out.push(a.join(' '));
    try {
      process.env.PATH = `${bin}${path.delimiter}${oldEnv.PATH}`;
      process.env.FAKE_YARN_LOG = log;
      if (env.fail) process.env.FAKE_YARN_FAIL = env.fail;
      else delete process.env.FAKE_YARN_FAIL;
      process.chdir(work);
      return await fn({
        work,
        out,
        yarnCalls: () =>
          fs.existsSync(log)
            ? fs
                .readFileSync(log, 'utf-8')
                .trim()
                .split('\n')
                .map((l) => {
                  const [args, cwd] = l.split('|');
                  return {args, cwd};
                })
            : [],
      });
    } finally {
      console.log = oldLog;
      process.chdir(oldCwd);
      for (const [k, v] of Object.entries(oldEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fs.rmSync(root, {recursive: true, force: true});
    }
  };

  describe('workspace-sdk create command', () => {
    it('strips every "/" and "." from the name', async () => {
      await sandbox(async ({work}) => {
        await create('a.b/c', {});
        assert.ok(fs.existsSync(path.join(work, 'abc/package.json')));
        assert.deepEqual(fs.readdirSync(work), ['abc']);
      });
    });

    it('throws "name is empty" before making any folder', async () => {
      await sandbox(async ({work, yarnCalls}) => {
        await assert.rejects(create('./.', {}), {message: 'name is empty'});
        await assert.rejects(create('', {}), {message: 'name is empty'});
        assert.deepEqual(fs.readdirSync(work), []);
        assert.deepEqual(yarnCalls(), []);
      });
    });

    it('fails on an existing folder and leaves its content untouched', async () => {
      await sandbox(async ({work, yarnCalls}) => {
        fs.mkdirSync(path.join(work, 'proj'));
        fs.writeFileSync(path.join(work, 'proj/package.json'), 'mine');
        await assert.rejects(create('proj', {}), {code: 'EEXIST'});
        assert.deepEqual(listFiles(path.join(work, 'proj')), ['package.json']);
        assert.equal(fs.readFileSync(path.join(work, 'proj/package.json'), 'utf-8'), 'mine');
        assert.deepEqual(yarnCalls(), []);
      });
    });

    it('copies the template files to the same relative paths', async () => {
      await sandbox(async ({work}) => {
        await create('proj', {});
        for (const f of FILES.filter((f) => f !== 'package.json')) {
          assert.equal(
            fs.readFileSync(path.join(work, 'proj', f), 'utf-8'),
            fs.readFileSync(path.join(templateRoot, f), 'utf-8'),
            f
          );
        }
      });
    });

    it('sets the package.json name and writes it with two-space indentation', async () => {
      await sandbox(async ({work}) => {
        await create('proj', {});
        const text = fs.readFileSync(path.join(work, 'proj/package.json'), 'utf-8');
        const template = JSON.parse(fs.readFileSync(path.join(templateRoot, 'package.json'), 'utf-8'));
        assert.deepEqual(JSON.parse(text), {...template, name: 'proj'});
        assert.equal(text, JSON.stringify({...template, name: 'proj'}, null, 2));
      });
    });

    it('writes a gitignore file with exactly the five lines', async () => {
      await sandbox(async ({work}) => {
        await create('proj', {});
        const lines = fs.readFileSync(path.join(work, 'proj/.gitignore'), 'utf-8').split('\n');
        assert.deepEqual(lines, ['.DS_Store', 'node_modules', 'build', '.' + 'env', 'yarn-error.log']);
      });
    });

    it('drift check: the command copies every template file and lists none that is missing', async () => {
      await sandbox(async ({work}) => {
        await create('proj', {});
        const expected = listFiles(templateRoot)
          .filter((f) => f !== '.gitignore' && !f.startsWith('node_modules'))
          .sort();
        const created = listFiles(path.join(work, 'proj'))
          .filter((f) => f !== '.gitignore')
          .sort();
        assert.deepEqual(created, expected);
        assert.deepEqual(expected, [...FILES].sort());
      });
    });

    it('runs yarn and then yarn build in the project folder', async () => {
      await sandbox(async ({work, yarnCalls}) => {
        await create('proj', {});
        assert.deepEqual(yarnCalls(), [
          {args: '', cwd: path.join(work, 'proj')},
          {args: 'build', cwd: path.join(work, 'proj')},
        ]);
      });
    });

    it('prints the three numbered next steps on success', async () => {
      await sandbox(async ({out}) => {
        await create('proj', {});
        const text = out.join('\n');
        assert.match(text, /Success!/);
        assert.match(text, /^1\.\) Create a new workspace in aloma$/m);
        assert.match(text, /^2\.\) Push the project to a git repository$/m);
        assert.match(text, /^3\.\) Configure workspace source sync in aloma$/m);
      });
    });

    for (const step of ['install', 'build']) {
      it(`rejects without "Success!" when yarn ${step} fails`, async () => {
        await sandbox(
          async ({out, yarnCalls}) => {
            await assert.rejects(create('proj', {}));
            assert.doesNotMatch(out.join('\n'), /Success!/);
            assert.equal(yarnCalls().length, step === 'install' ? 1 : 2);
          },
          {fail: step}
        );
      });
    }

    it('fails with "source <path> does not exist" when the template folder is missing', async () => {
      const tree = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-create-tree-')));
      try {
        fs.cpSync(path.join(wsRoot, 'src'), path.join(tree, 'src'), {recursive: true});
        fs.cpSync(path.join(wsRoot, 'template'), path.join(tree, 'template'), {recursive: true});
        fs.rmSync(path.join(tree, 'template'), {recursive: true, force: true});
        const copied = await import(pathToFileURL(path.join(tree, 'src/commands/create.mts')).href);
        await sandbox(async () => {
          await assert.rejects(copied.create('proj', {}), (e) => {
            assert.match(e.message, /^source .*template\/workspace\/ does not exist$/);
            assert.ok(e.message.includes(`${tree}/src/commands/../../template/workspace/`));
            return true;
          });
        });
      } finally {
        fs.rmSync(tree, {recursive: true, force: true});
      }
    });
  });
}
