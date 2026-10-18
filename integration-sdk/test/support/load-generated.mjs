import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import ts from 'typescript';
import {parseFromFiles} from '@ts-ast-parser/core';
import {buildResolvers} from '../../build/builder/runtime-context.mjs';
import transform from '../../build/transform/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sdkEntry = pathToFileURL(path.resolve(here, '../../build/index.mjs')).href;

// Writes generated TypeScript to a temp folder, transpiles it, and returns the module.
// The SDK import is pointed at this checkout's build.
function emit(dir, rel, code) {
  const out = ts.transpileModule(code, {
    compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
  }).outputText;
  const file = path.join(dir, rel.replace(/\.mts$/, '.mjs'));
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, out.replaceAll("'@aloma.io/integration-sdk'", `'${sdkEntry}'`));
  return file;
}

const sdkRoot = path.resolve(here, '../..');

// A temp connector folder that resolves '@aloma.io/integration-sdk' to this checkout, as a real
// connector project resolves it from its node_modules.
export function tempDir() {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'openapi-gen-test-'));
  fs.mkdirSync(path.join(dir, 'node_modules/@aloma.io'), {recursive: true});
  fs.symlinkSync(sdkRoot, path.join(dir, 'node_modules/@aloma.io/integration-sdk'), 'dir');
  fs.copyFileSync(path.join(sdkRoot, 'template/connector/tsconfig.json'), path.join(dir, 'tsconfig.json'));
  return dir;
}

// The connector build runs the transform from the connector folder, so it uses that folder's tsconfig.
async function inFolder(dir, fn) {
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(cwd);
  }
}

// files: {'controller/index.mts': code, 'resources/x.mts': code}, laid out under src/ as in a connector.
// config is the connector's configuration; getClient replaces the recording client when given.
export async function loadConnector(files, {config = {}, getClient} = {}) {
  const dir = tempDir();
  const src = path.join(dir, 'src');
  let controllerFile;
  for (const [rel, code] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(src, rel)), {recursive: true});
    fs.writeFileSync(path.join(src, rel), code);
    const file = emit(path.join(dir, 'build'), rel, code);
    if (rel.startsWith('controller/')) controllerFile = file;
  }

  const entry = path.join(src, 'controller/index.mts');
  const {default: Controller} = await import(pathToFileURL(controllerFile).href);

  // Introspection, as the connector build does it. A type error is kept so a test can assert on it,
  // and the methods are then read from the class so the behaviour tests still run.
  let meta;
  try {
    meta = await inFolder(dir, () => transform(entry));
  } catch (e) {
    const parsed = await inFolder(dir, () => parseFromFiles([entry]));
    const text = (parsed.errors || []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ');
    const methods = Object.getOwnPropertyNames(Controller.prototype).filter(
      (m) => m !== 'constructor' && !m.startsWith('_') && typeof Controller.prototype[m] === 'function'
    );
    meta = {text: '', methods, error: text || e.message};
  }

  const calls = [];
  const api = {
    fetch: async (url, options = {}) => {
      calls.push({url, options});
      return {ok: true};
    },
  };

  const controller = new Controller();
  const noop = async () => {};
  await controller._doStart(config, null, noop, noop, getClient || (() => api), noop, noop, noop);

  const resolvers = buildResolvers(meta.methods, controller);

  // Calls a method the way the connector runtime does: one args object, then ctx.
  const call = async (method, args) => resolvers[method](args, {taskId: 't-test'});

  return {dir, meta, calls, call, controller};
}

export function lastCall(calls) {
  if (!calls.length) throw new Error('no request was made');
  return calls[calls.length - 1];
}
