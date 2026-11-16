// Module-customisation hook for ws-step-parser.test.mjs only.
// Maps the 'jshint' specifier to an in-test fake. The fake records every call on
// globalThis.__wsStepParserJshint.calls ({source, options}); it returns true with no
// errors, unless the source contains SYNTAXMARK: then false, with one error on line 3.
const FAKE_URL = 'ws-step-parser-fake:jshint';

const FAKE_SOURCE = `
const JSHINT = (source, options) => {
  globalThis.__wsStepParserJshint.calls.push({source, options});
  if (source.includes('SYNTAXMARK')) {
    JSHINT.errors = [{line: 3, reason: 'bad'}];
    return false;
  }
  JSHINT.errors = [];
  return true;
};
JSHINT.errors = [];
export default {JSHINT};
`;

export const resolve = (specifier, context, nextResolve) => {
  if (specifier === 'jshint') return {url: FAKE_URL, shortCircuit: true};
  return nextResolve(specifier, context);
};

export const load = (url, context, nextLoad) => {
  if (url === FAKE_URL) return {format: 'module', source: FAKE_SOURCE, shortCircuit: true};
  return nextLoad(url, context);
};
