// Regression row 1.01 (PLAT-21): the workspace-sdk `pull` command.
// Plain node:test file; run with `node --test integration-sdk/test/ws-pull-command.test.mjs`.
// The source is imported as .mts (type stripping by Node). 'yaml' and the build import are replaced by in-test fakes
// (helpers/ws-pull-hooks.mjs); globalThis.fetch is a recording fake, so nothing leaves the machine.
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {register} from 'node:module';

const KEY = 'not-a-token';
const GRAPHQL = 'https://graph.aloma.io/graphql';

if (!process.features.typescript) {
  console.log('SKIP ws-pull-command: this Node cannot strip TypeScript types (needs Node 22.18 or later)');
  process.exit(0);
}

register('./helpers/ws-pull-hooks.mjs', import.meta.url);
const {pull, pullAll} = await import('../../workspace-sdk/src/commands/pull.mts');

const realFetch = globalThis.fetch;
const realLog = console.log;
const realKey = process.env.ALOMA_KEY;
const startDir = process.cwd();

let fetchCalls;
let lines;
let handler;

// Runs fn inside a fresh temp folder with the fake fetch and a recording console.
const inTemp = async (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-pull-'));
  fetchCalls = [];
  lines = [];
  globalThis.__wsPullLines = lines;
  globalThis.__wsPullBuilds = [];
  process.env.ALOMA_KEY = KEY;
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({url, options});
    if (url !== GRAPHQL) throw new Error(`unexpected URL: ${url}`);
    const answer = await handler(JSON.parse(options.body), options);
    return {status: answer.status ?? 200, text: async () => answer.text ?? JSON.stringify(answer.json)};
  };
  console.log = (...args) => lines.push(args.join(' '));
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(startDir);
    console.log = realLog;
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ALOMA_KEY;
    else process.env.ALOMA_KEY = realKey;
    fs.rmSync(dir, {recursive: true, force: true});
  }
};

// Answers by query: workspace lookup and step list.
const serve = ({workspace = {id: 'w1', name: 'Demo'}, steps = [], workspaceAnswer, stepsAnswer} = {}) => {
  handler = (body) => {
    if (body.query.includes('getAutomationEnvironment')) {
      return workspaceAnswer || {json: {data: {getAutomationEnvironment: workspace}}};
    }
    return stepsAnswer || {json: {data: {listAutomationSteps: steps}}};
  };
};

const step = (name, extra = {}) => ({
  id: `id-${name}`,
  name,
  content: {if: 'true', do: '  return 1;'},
  version: 3,
  enabled: true,
  valid: true,
  updatedAt: '2026-01-01',
  ...extra,
});

const listFiles = (dir) => fs.readdirSync(dir, {recursive: true}).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();

describe('ws pull: requests', () => {
  it('without ALOMA_KEY the request fails with Missing API key and nothing is fetched', async () => {
    await inTemp(async () => {
      serve();
      delete process.env.ALOMA_KEY;
      await assert.rejects(pull('w1', {}), /^Error: id: w1 Missing API key/);
      assert.equal(fetchCalls.length, 0);
    });
  });

  it('a request after the key was removed fails with a message starting Missing API key', async () => {
    await inTemp(async () => {
      handler = () => {
        delete process.env.ALOMA_KEY;
        return {json: {data: {getAutomationEnvironment: {id: 'w1', name: 'Demo'}}}};
      };
      await assert.rejects(pull('w1', {}), (e) => e.message.startsWith('Missing API key'));
      assert.equal(fetchCalls.length, 1);
    });
  });

  it('requests go to the graph endpoint with the key as a bearer header, and the key is never printed', async () => {
    await inTemp(async () => {
      serve({steps: [step('one')]});
      await pull('w1', {});
      assert.equal(fetchCalls.length, 2);
      for (const call of fetchCalls) {
        assert.equal(call.url, GRAPHQL);
        assert.equal(call.options.method, 'POST');
        assert.equal(call.options.headers.Authorization, `Bearer ${KEY}`);
        assert.equal(call.options.headers['content-type'], 'application/json');
      }
      const [first, second] = fetchCalls.map((c) => JSON.parse(c.options.body));
      assert.match(first.query, /getAutomationEnvironment/);
      assert.deepEqual(first.variables, {id: 'w1'});
      assert.match(second.query, /listAutomationSteps/);
      assert.deepEqual(second.variables, {id: 'w1'});
      assert.ok(!lines.join('\n').includes(KEY));
    });
  });

  it('a status above 399 fails with "<status>: <body>" and the status as error code', async () => {
    await inTemp(async () => {
      serve({stepsAnswer: {status: 500, text: 'boom'}});
      await assert.rejects(pull('w1', {}), (e) => e.message === '500: boom' && e.code === 500 && !e.message.includes(KEY));
    });
  });

  it('status 400 fails and status 399 is accepted', async () => {
    await inTemp(async () => {
      serve({stepsAnswer: {status: 400, text: '{"data":{"listAutomationSteps":[]}}'}});
      await assert.rejects(pull('w1', {}), (e) => e.message.startsWith('400: ') && e.code === 400);
    });
    await inTemp(async () => {
      serve({stepsAnswer: {status: 399, text: '{"data":{"listAutomationSteps":[]}}'}});
      await pull('w1', {});
      assert.equal(globalThis.__wsPullBuilds.length, 1);
    });
  });

  it('a body that is not JSON fails with the parse message and the text', async () => {
    await inTemp(async () => {
      serve({stepsAnswer: {text: '<html>nope</html>'}});
      let expected;
      try {
        JSON.parse('<html>nope</html>');
      } catch (e) {
        expected = `${e.message}: <html>nope</html>`;
      }
      await assert.rejects(pull('w1', {}), (e) => e.message === expected);
    });
  });

  it('a workspace lookup failure is reported as "id: <id> <message>"', async () => {
    await inTemp(async () => {
      serve({workspaceAnswer: {status: 404, text: 'gone'}});
      await assert.rejects(pull('w-77', {}), (e) => e.message === 'id: w-77 404: gone');
      assert.equal(fetchCalls.length, 1);
    });
  });
});

describe('ws pull: GraphQL answer shapes', () => {
  it('one top-level field returns that field value', async () => {
    await inTemp(async () => {
      serve({workspace: {id: 'w9', name: 'Single'}});
      await pull('w1', {});
      assert.ok(lines.includes('Updating from workspace Single (id: w9) ...'));
    });
  });

  it('several top-level fields return all of them', async () => {
    await inTemp(async () => {
      serve({workspaceAnswer: {json: {data: {id: 'w5', name: 'Several', other: 1}}}});
      await pull('w1', {});
      assert.ok(lines.includes('Updating from workspace Several (id: w5) ...'));
    });
  });

  it('an answer without data returns undefined (the workspace name cannot be read)', async () => {
    await inTemp(async () => {
      serve({workspaceAnswer: {json: {errors: ['x']}}});
      await assert.rejects(pull('w1', {}), TypeError);
      assert.equal(fetchCalls.length, 1);
      assert.equal(globalThis.__wsPullBuilds.length, 0);
    });
  });
});

describe('ws pull: writing steps', () => {
  it('prints progress, writes only usable steps, then calls build once after all files', async () => {
    await inTemp(async (dir) => {
      serve({
        steps: [
          step('alpha'),
          step('off', {enabled: false}),
          step('nocode', {nocode_type: 'form'}),
          step('', {id: 'id-blank'}),
          step('beta', {content: {if: 'data.x > 1', do: '  return data.x;'}}),
        ],
      });
      await pull('w1', {});

      assert.deepEqual(listFiles(path.join(dir, 'src/steps')), ['alpha.mts', 'beta.mts']);
      assert.deepEqual(lines, [
        'Updating from workspace Demo (id: w1) ...',
        '  alpha (id: id-alpha) ...',
        '  beta (id: id-beta) ...',
        'Update successful.',
      ]);

      const beta = fs.readFileSync(path.join(dir, 'src/steps/beta.mts'), 'utf-8');
      assert.equal(
        beta,
        `/**
  Name:       beta

  ID:         id-beta
  Version:    3
  Path:       ./src/steps/beta.mts
  UpdatedAt:  2026-01-01

  Workspace:  w1
*/

// @ts-nocheck

export const match = () => (data.x > 1);

export default async (data: any) => {
  return data.x;
}
`
      );

      assert.equal(globalThis.__wsPullBuilds.length, 1);
      assert.deepEqual(globalThis.__wsPullBuilds[0].files, ['alpha.mts', 'beta.mts']);
      assert.equal(globalThis.__wsPullBuilds[0].lines, lines.length);
    });
  });

  it('a name with slashes becomes folders and the last part gets .mts', async () => {
    await inTemp(async (dir) => {
      serve({steps: [step('billing/invoices/create')]});
      await pull('w1', {});
      const file = path.join(dir, 'src/steps/billing/invoices/create.mts');
      assert.ok(fs.existsSync(file));
      assert.match(fs.readFileSync(file, 'utf-8'), /Path:       \.\/src\/steps\/billing\/invoices\/create\.mts\n/);
      assert.match(fs.readFileSync(file, 'utf-8'), /Name:       billing\/invoices\/create\n/);
    });
  });

  it('empty name parts are skipped', async () => {
    await inTemp(async (dir) => {
      serve({steps: [step('/a// /b')]});
      await pull('w1', {});
      assert.deepEqual(listFiles(path.join(dir, 'src/steps')), ['a/b.mts']);
    });
  });

  it('name parts that start with a dot are skipped', async () => {
    await inTemp(async (dir) => {
      serve({steps: [step('team/.hidden/run'), step('.secret/other')]});
      await pull('w1', {});
      assert.deepEqual(listFiles(path.join(dir, 'src/steps')), ['other.mts', 'team/run.mts']);
    });
  });

  it('a disabled step is not written', async () => {
    await inTemp(async (dir) => {
      serve({steps: [step('on'), step('off', {enabled: false})]});
      await pull('w1', {});
      assert.deepEqual(listFiles(path.join(dir, 'src/steps')), ['on.mts']);
    });
  });

  it('a step with a nocode_type is not written', async () => {
    await inTemp(async (dir) => {
      serve({steps: [step('code'), step('visual', {nocode_type: 'flow'})]});
      await pull('w1', {});
      assert.deepEqual(listFiles(path.join(dir, 'src/steps')), ['code.mts']);
    });
  });
});

describe('ws pull: target folder', () => {
  it('creates ./src/steps/ when it does not exist, even with no steps', async () => {
    await inTemp(async (dir) => {
      serve({steps: []});
      assert.ok(!fs.existsSync(path.join(dir, 'src')));
      await pull('w1', {});
      assert.ok(fs.statSync(path.join(dir, 'src/steps')).isDirectory());
    });
  });

  it('reuses ./src/steps/ when it exists and keeps the files in it', async () => {
    await inTemp(async (dir) => {
      fs.mkdirSync(path.join(dir, 'src/steps'), {recursive: true});
      fs.writeFileSync(path.join(dir, 'src/steps/old.mts'), 'old');
      serve({steps: [step('new')]});
      await pull('w1', {});
      assert.deepEqual(listFiles(path.join(dir, 'src/steps')), ['new.mts', 'old.mts']);
      assert.equal(fs.readFileSync(path.join(dir, 'src/steps/old.mts'), 'utf-8'), 'old');
    });
  });
});

describe('ws pullAll', () => {
  const missing = /Missing config file[\s\S]*pull:\n {2}workspaces:\n {4}- a-workspace-id/;

  it('without ./.aloma.yaml it fails with the Missing config file text', async () => {
    await inTemp(async () => {
      serve();
      await assert.rejects(pullAll({}), missing);
      assert.equal(fetchCalls.length, 0);
    });
  });

  it('a config without pull.workspaces fails the same way', async () => {
    await inTemp(async (dir) => {
      serve();
      for (const config of [{}, {pull: {}}, {other: 1}]) {
        fs.writeFileSync(path.join(dir, '.aloma.yaml'), JSON.stringify(config));
        await assert.rejects(pullAll({}), missing);
      }
      assert.equal(fetchCalls.length, 0);
      assert.equal(globalThis.__wsPullBuilds.length, 0);
    });
  });

  it('a config with an empty workspace list fails the same way', async () => {
    await inTemp(async (dir) => {
      serve();
      fs.writeFileSync(path.join(dir, '.aloma.yaml'), JSON.stringify({pull: {workspaces: []}}));
      await assert.rejects(pullAll({}), missing);
      assert.equal(fetchCalls.length, 0);
    });
  });

  it('with workspaces it pulls each in order and builds once per workspace', async () => {
    await inTemp(async (dir) => {
      handler = (body) =>
        body.query.includes('getAutomationEnvironment')
          ? {json: {data: {getAutomationEnvironment: {id: body.variables.id, name: `N-${body.variables.id}`}}}}
          : {json: {data: {listAutomationSteps: [step(`s-${body.variables.id}`)]}}};
      fs.writeFileSync(path.join(dir, '.aloma.yaml'), JSON.stringify({pull: {workspaces: ['wa', 'wb']}}));
      await pullAll({});

      assert.deepEqual(
        fetchCalls.map((c) => JSON.parse(c.options.body).variables.id),
        ['wa', 'wa', 'wb', 'wb']
      );
      assert.deepEqual(lines.filter((l) => l.startsWith('Updating')), [
        'Updating from workspace N-wa (id: wa) ...',
        'Updating from workspace N-wb (id: wb) ...',
      ]);
      assert.equal(globalThis.__wsPullBuilds.length, 2);
      assert.deepEqual(listFiles(path.join(dir, 'src/steps')), ['s-wa.mts', 's-wb.mts']);
    });
  });
});
