// The controller transform's constant resolution (the default value of a destructured parameter) and its type text
// (tuple, named tuple, optional, rest, indexed access, array, parenthesised), through three fixtures in
// test/fixtures/transform/expr-*. The expected strings are written out here; where the transform prints something
// other than what a reader might expect (quotes kept on a string default, nothing printed for a null default, `any`
// for a property written in a type literal), the test pins what it prints today.
// Needs `yarn build` first. Offline.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {suite, assertEqual} from './helpers/mini.mjs';
import transform from '../build/transform/index.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transform');

// the transform reads tsconfig.json from the working directory, as `cli build` runs it from the connector folder
const run = async (name) => {
  const before = process.cwd();
  process.chdir(path.join(fixtures, name));
  try {
    return await transform('./src/controller/index.mts');
  } finally {
    process.chdir(before);
  }
};

// one declared function: the binding part (defaults), the property lines, and the return type
const declared = (text, name) => {
  const found = text.match(new RegExp(`declare function ${name}\\((\\{[^\\n]*?\\}): \\{([\\s\\S]*?)\\}\\): ([^\\n]*);\\n`));
  if (!found) throw new Error(`no declaration of ${name} in:\n${text}`);
  const props = [...found[2].matchAll(/\n (\w+): ([^\n]*?);? ?(?=\n|$)/g)].map((m) => `${m[1]}: ${m[2]}`);
  return {binding: found[1], props, ret: found[3]};
};

const t = suite('transform expressions and types');

const defaults = await run('expr-defaults');
const types = await run('expr-types');
const props = await run('expr-props');

await t.test('methods of the three fixtures are listed', async () => {
  assertEqual(defaults.methods, ['unary', 'named']);
  assertEqual(types.methods, ['shapes', 'docNamed', 'docParen', 'pick', 'pairBack']);
  assertEqual(props.methods, ['viaAlias', 'viaShape']);
});

await t.test('default values: negative number, unary plus, negated boolean, as const, parentheses, assertion', async () => {
  const {binding} = declared(defaults.text, 'unary');
  assertEqual(
    binding,
    "{neg = -5; plus = 5; not = false; word = 'x'; paren = 7; asserted = 8; bitwise = 5; notNull}",
  );
});

await t.test('default values: a prefix operator the code does not define returns the operand; a non-scalar operand prints nothing', async () => {
  const {binding} = declared(defaults.text, 'unary');
  // `~5` is not handled: the operand's value comes back. `!null` has a null operand: no default is printed.
  assertEqual(binding.includes('bitwise = 5;'), true);
  assertEqual(binding.endsWith('notNull}'), true);
});

await t.test('default values: a module constant, a static property and an imported constant resolve to their values', async () => {
  const {binding} = declared(defaults.text, 'named');
  assertEqual(binding.startsWith("{local = 'local'; own = 10; imported = 3;"), true);
});

await t.test('default values: a name from a third-party package is printed as its source text', async () => {
  const {binding} = declared(defaults.text, 'named');
  assertEqual(binding.includes('thirdParty = ts.version;'), true);
});

await t.test('default values: null prints no default, undefined prints as undefined', async () => {
  const {binding} = declared(defaults.text, 'named');
  assertEqual(binding.endsWith('; nothing; missing = undefined}'), true);
});

await t.test('type text: a tuple prints as [A, B]', async () => {
  assertEqual(declared(types.text, 'shapes').props[0], 'pair: [string, number]');
  assertEqual(declared(types.text, 'pairBack').ret, '[string, (number | undefined)?]');
});

await t.test('type text: a named tuple member prints as name: A', async () => {
  assertEqual(declared(types.text, 'docNamed').ret, '[first: string, second: number]');
});

await t.test('type text: an optional tuple element prints as A?', async () => {
  // as a property type the element of the optional position is printed `any`; as a return type it keeps its type
  assertEqual(declared(types.text, 'shapes').props[1], 'optional: [string, any?]');
  assertEqual(declared(types.text, 'pairBack').ret.endsWith('?]'), true);
});

await t.test('type text: a rest element prints as ...A[]', async () => {
  assertEqual(declared(types.text, 'shapes').props[2], 'rest: [string, ...number[]]');
});

await t.test('type text: an indexed-access type prints as T[K]', async () => {
  assertEqual(declared(types.text, 'pick').ret, 'T[K]');
});

await t.test('type text: arrays print as A[], a parenthesised union keeps its meaning', async () => {
  const shapes = declared(types.text, 'shapes').props;
  assertEqual(shapes[3], 'list: string[]');
  assertEqual(shapes[4], 'either: any[]'); // today the union inside the array prints as any
  assertEqual(shapes[5], 'wrapped: string | number');
  assertEqual(shapes[6], 'grid: boolean[][]');
  assertEqual(declared(types.text, 'docParen').ret, 'string | number');
});

await t.test('properties of an alias or interface parameter are listed in declaration order with their types', async () => {
  assertEqual(declared(props.text, 'viaAlias').props, ['zeta: string', 'alpha: number[]', 'mid: boolean | null']);
  assertEqual(declared(props.text, 'viaShape').props, ['second: string', 'first: number']);
});

t.finish();
