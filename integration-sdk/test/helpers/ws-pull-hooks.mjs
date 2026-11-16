// Module-customisation hook for ws-pull-command.test.mjs (PLAT-21). Not a test itself.
// - 'yaml' resolves to a fake whose parse() is JSON.parse (the test writes the config as JSON, which is valid YAML).
// - the './build.mjs' import of the workspace-sdk sources resolves to a fake that records each call
//   (globalThis.__wsPullBuilds): the files below ./src/steps and the number of console lines printed so far.
// - any other relative .mjs import from workspace-sdk/src resolves to the .mts file next to it.
const FAKE_YAML = 'export const parse = (text) => JSON.parse(text);';

const FAKE_BUILD = `
import fs from 'node:fs';
export const build = async () => {
  const files = fs.existsSync('./src/steps') ? fs.readdirSync('./src/steps', {recursive: true}).sort() : [];
  (globalThis.__wsPullBuilds ||= []).push({files, lines: (globalThis.__wsPullLines || []).length});
};`;

const dataUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

export const resolve = async (specifier, context, next) => {
  if (specifier === 'yaml') return {url: dataUrl(FAKE_YAML), shortCircuit: true};

  const fromSdk = String(context.parentURL || '').includes('/workspace-sdk/src/');
  if (fromSdk && specifier === './build.mjs') return {url: dataUrl(FAKE_BUILD), shortCircuit: true};
  if (fromSdk && specifier.startsWith('.') && specifier.endsWith('.mjs')) {
    return next(specifier.replace(/\.mjs$/, '.mts'), context);
  }

  return next(specifier, context);
};
