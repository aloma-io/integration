// PLAT-21: the connector `build` command (logo copy, clean build/), the descriptor writer (build/.controller.json) and
// the add-resource branch for a controller without import lines. Standalone script (no mocha); needs `yarn build` first.
// `build` writes into the project folder found by walking five levels up from the CLI file (the folder that holds
// node_modules), so the built CLI is copied into a fresh temporary project at
// node_modules/@aloma-io/integration-sdk/build and runs from there: nothing outside the temporary folder is written.
// The SDK's dependencies are linked into that project by name, from the SDK's own package.json. No installs, no network.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assert, assertEqual, suite} from './helpers/mini.mjs';

const {test, finish} = suite('CLI build, descriptor writer and add-resource imports');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(root, 'build');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-build-')));
let counter = 0;

const CONTROLLER = `export default class Controller {
  /**
   * say hello to someone
   */
  async hello(args: any) {
    return {hi: 'world'};
  }

  /**
   * say goodbye to someone
   */
  async goodbye(args: any) {
    return {bye: 'world'};
  }
}
`;

const OWNERS = {
  openapi: '3.0.0',
  info: {title: 'Owners', version: '1.0.0'},
  servers: [{url: 'https://owners.example.com'}],
  paths: {
    '/owners': {get: {operationId: 'listOwners', summary: 'List owners', responses: {200: {description: 'ok'}}}},
  },
};

// a fresh temporary project with the built CLI installed where a connector project has it
const project = ({controller = CONTROLLER, packageJson = {name: 'demo', connectorId: 'demo-id', version: '1.2.3'}} = {}) => {
  const dir = path.join(base, `p${++counter}`);
  const sdk = path.join(dir, 'node_modules/@aloma-io/integration-sdk');
  fs.mkdirSync(path.join(dir, 'src/controller'), {recursive: true});
  fs.mkdirSync(sdk, {recursive: true});
  fs.cpSync(BUILD, path.join(sdk, 'build'), {recursive: true});
  fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({name: '@aloma-io/integration-sdk', type: 'module'}));
  for (const dep of Object.keys(pkg.dependencies)) {
    const from = path.join(root, 'node_modules', dep);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dir, 'node_modules', dep);
    fs.mkdirSync(path.dirname(to), {recursive: true});
    fs.symlinkSync(from, to);
  }
  if (packageJson) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(packageJson));
  if (controller !== null) fs.writeFileSync(path.join(dir, 'src/controller/index.mts'), controller);
  return {
    dir,
    cli: (args) => {
      const r = spawnSync(process.execPath, [path.join(sdk, 'build/cli.mjs'), ...args], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 120000,
      });
      return {code: r.status, out: r.stdout, err: r.stderr};
    },
    path: (rel) => path.join(dir, rel),
    exists: (rel) => fs.existsSync(path.join(dir, rel)),
    read: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
    write: (rel, content) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), {recursive: true});
      fs.writeFileSync(path.join(dir, rel), content);
    },
  };
};

try {
  // --- build: build/ folder and logo ---

  await test('build copies logo.png from the project folder into build/', async () => {
    const p = project();
    p.write('logo.png', 'not-a-real-image');
    const r = p.cli(['build']);
    assertEqual(r.code, 0, `exit code (${r.err})`);
    assertEqual(p.read('build/logo.png'), 'not-a-real-image', 'logo content');
  });

  await test('build without a logo still succeeds and build/ has no logo', async () => {
    const p = project();
    const r = p.cli(['build']);
    assertEqual(r.code, 0, `exit code (${r.err})`);
    assert(p.exists('build'), 'build/ exists');
    assert(!p.exists('build/logo.png'), 'no logo in build/');
    assert(p.exists('build/.controller.json'), 'descriptor still written');
  });

  await test('build removes the old content of build/ first', async () => {
    const p = project();
    p.write('build/stale.txt', 'old');
    p.write('build/nested/old.js', 'old');
    const r = p.cli(['build']);
    assertEqual(r.code, 0, `exit code (${r.err})`);
    assert(!p.exists('build/stale.txt'), 'stale file is gone');
    assert(!p.exists('build/nested'), 'stale folder is gone');
  });

  // --- build: descriptor ---

  await test('build writes build/.controller.json with exactly text, methods, connectorId and version', async () => {
    const p = project();
    const r = p.cli(['build']);
    assertEqual(r.code, 0, `exit code (${r.err})`);
    const d = JSON.parse(p.read('build/.controller.json'));
    assertEqual(Object.keys(d).sort(), ['connectorId', 'methods', 'text', 'version'], 'keys');
    assertEqual(d.connectorId, 'demo-id', 'connectorId from package.json');
    assertEqual(d.version, '1.2.3', 'version from package.json');
    assertEqual([...d.methods].sort(), ['goodbye', 'hello'], 'method names');
    assert(typeof d.text === 'string' && d.text.includes('hello') && d.text.includes('goodbye'), 'text mentions both methods');
  });

  await test('build takes connectorId and version from the package.json it finds, not from fixed values', async () => {
    const p = project({packageJson: {name: 'other', connectorId: 'other-id', version: '9.8.7'}});
    p.cli(['build']);
    const d = JSON.parse(p.read('build/.controller.json'));
    assertEqual([d.connectorId, d.version], ['other-id', '9.8.7'], 'values');
  });

  await test('build with a missing package.json fails (non-zero exit) and writes no .controller.json', async () => {
    const p = project({packageJson: null});
    const r = p.cli(['build']);
    assert(r.code !== 0, `exit code is non-zero (got ${r.code})`);
    assert(!p.exists('build/.controller.json'), 'no descriptor');
  });

  await test('build with a missing controller source fails (non-zero exit) and writes no .controller.json', async () => {
    const p = project({controller: null});
    const r = p.cli(['build']);
    assert(r.code !== 0, `exit code is non-zero (got ${r.code})`);
    assert(!p.exists('build/.controller.json'), 'no descriptor');
  });

  await test('the descriptor writer refuses an empty source with "source cannot be empty" and writes nothing', async () => {
    // the class is not exported and the command passes a fixed path, so its code is taken from the built file
    // and run in a module of its own inside the temporary folder
    const p = project();
    const src = fs.readFileSync(path.join(BUILD, 'cli.mjs'), 'utf8');
    const start = src.indexOf('class Extractor');
    assert(start >= 0, 'class Extractor is in the built CLI');
    const end = src.indexOf('\n}\n', start) + 2;
    const href = (rel) => JSON.stringify(path.join(BUILD, rel));
    p.write(
      'extractor.mjs',
      `import fs from 'node:fs';
import {notEmpty} from ${href('internal/util/index.mjs')};
import parseTypes from ${href('transform/index.mjs')};
const TARGET_DIR = ${JSON.stringify(p.dir + '/')};
${src.slice(start, end)}
export {Extractor};
`
    );
    const {Extractor} = await import(p.path('extractor.mjs'));
    const target = p.path('out.json');
    for (const source of ['', '   ']) {
      let message;
      try {
        await new Extractor().extract(source, target);
      } catch (e) {
        message = e.message;
      }
      assertEqual(message, 'source cannot be empty', `message for "${source}"`);
    }
    assert(!fs.existsSync(target), 'nothing written');
  });

  // --- add-resource: import placement ---

  const addResource = (p) => {
    const spec = p.path('owners.json');
    fs.writeFileSync(spec, JSON.stringify(OWNERS));
    return p.cli(['add-resource', '.', '--className', 'OwnersResource', '--spec', spec, '--no-build']);
  };
  const IMPORT = "import * as ownersFunctions from '../resources/owners.mjs';";
  const BINDING = "this.bindResourceFunctions('owners', ownersFunctions);";
  const BODY = `export default class Controller {
  pets: any = {};

  async start() {
    this.bindResourceFunctions('pets', petsFunctions);
  }
}
`;

  await test('add-resource in a controller without imports puts the import at the very top, then one blank line, and still adds the binding', async () => {
    const p = project({controller: BODY});
    const r = addResource(p);
    assertEqual(r.code, 0, `exit code (${r.err})`);
    const code = p.read('src/controller/index.mts');
    assert(code.startsWith(`${IMPORT}\n\nexport default class Controller {`), 'import, one blank line, then the old first line');
    assert(code.includes(`    ${BINDING}`), 'binding added');
    assert(code.indexOf(BINDING) > code.indexOf("bindResourceFunctions('pets'"), 'binding after the existing binding');
    assertEqual(code.split(IMPORT).length - 1, 1, 'import once');
  });

  await test('add-resource in a controller with imports puts the import right after the last import line', async () => {
    const p = project({
      controller: `import {Thing} from './thing.mjs';\nimport * as petsFunctions from '../resources/pets.mjs';\n\n${BODY}`,
    });
    const r = addResource(p);
    assertEqual(r.code, 0, `exit code (${r.err})`);
    const code = p.read('src/controller/index.mts');
    assert(
      code.startsWith(`import {Thing} from './thing.mjs';\nimport * as petsFunctions from '../resources/pets.mjs';\n${IMPORT}\n\nexport default`),
      `import directly after the last import line (got ${JSON.stringify(code.slice(0, 220))})`
    );
    assert(code.includes(`    ${BINDING}`), 'binding added');
  });
} finally {
  fs.rmSync(base, {recursive: true, force: true});
}
finish();
