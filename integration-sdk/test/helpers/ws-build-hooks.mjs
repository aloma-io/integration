// Module-customisation hook for ws-build-command.test.mjs only.
// The step parser import is mapped to an in-test fake (a data: module that
// returns whatever the test put on globalThis.__wsBuildSteps), so jshint is
// never loaded. Other relative .mjs imports are mapped to the .mts next to them.
const FAKE_PARSER = `export default async (dir) => {
  globalThis.__wsBuildParseDirs?.push(dir);
  return globalThis.__wsBuildSteps ?? [];
};`;

export async function resolve(specifier, context, nextResolve) {
  if (/(^|\/)step-parser\/index\.mjs$/.test(specifier)) {
    return {
      url: `data:text/javascript,${encodeURIComponent(FAKE_PARSER)}`,
      shortCircuit: true,
    };
  }

  if (specifier.startsWith('.') && specifier.endsWith('.mjs')) {
    return nextResolve(specifier.replace(/\.mjs$/, '.mts'), context);
  }

  return nextResolve(specifier, context);
}
