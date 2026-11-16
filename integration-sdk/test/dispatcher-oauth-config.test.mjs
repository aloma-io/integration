// The dispatcher's oauth() configuration builder: platform branch, the two "need a ..." errors, client and scope fields, merge rule.
import {Dispatcher} from '../build/internal/dispatcher/index.mjs';
import {suite, assert, assertEqual} from './helpers/mini.mjs';

const {test, finish} = suite('dispatcher oauth() configuration');

const base = {authorizationURL: 'http://127.0.0.1/auth', tokenURL: 'http://127.0.0.1/token'};
const fields = (d) => d._config.fields;
const messageOf = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.message;
  }
  return undefined;
};

await test('platformOAuth: returns the dispatcher, sets oauth, adds a managed oauthResult, installs no settings and no client or scope field', () => {
  const d = new Dispatcher();
  const out = d.oauth({platformOAuth: true, configurableClient: true, configurableClientScope: 'a b', authorizationURL: base.authorizationURL, tokenURL: base.tokenURL});
  assert(out === d, 'returns the dispatcher');
  assertEqual(d._config.oauth, true);
  assertEqual(d._oauth, undefined);
  assertEqual(Object.keys(fields(d)), ['oauthResult']);
  assertEqual(fields(d).oauthResult.type, 'managed');
  assert(!('clientId' in fields(d)) && !('clientSecret' in fields(d)) && !('scope' in fields(d)));
});

await test('without platformOAuth: a missing authorizationURL throws "need a authorizationURL"', () => {
  assertEqual(messageOf(() => new Dispatcher().oauth({tokenURL: base.tokenURL})), 'need a authorizationURL');
});

await test('without platformOAuth: neither tokenURL nor finishOAuth throws "need a tokenURL or finishOAuth()"', () => {
  assertEqual(messageOf(() => new Dispatcher().oauth({authorizationURL: base.authorizationURL})), 'need a tokenURL or finishOAuth()');
});

await test('without platformOAuth: finishOAuth alone is accepted, and so is tokenURL alone', () => {
  const d1 = new Dispatcher();
  assert(d1.oauth({authorizationURL: base.authorizationURL, finishOAuth: async () => ({})}) === d1);
  const d2 = new Dispatcher();
  assert(d2.oauth({authorizationURL: base.authorizationURL, tokenURL: base.tokenURL}) === d2);
  assertEqual(d2._config.oauth, true);
});

await test('the settings are stored as a copy of the argument', () => {
  const arg = {...base};
  const d = new Dispatcher();
  d.oauth(arg);
  assert(d._oauth !== arg, 'not the same object');
  arg.authorizationURL = 'changed';
  arg.extra = 1;
  assertEqual(d._oauth.authorizationURL, base.authorizationURL);
  assert(!('extra' in d._oauth));
});

await test('connectionOptional makes oauthResult optional; without it the field is not optional', () => {
  const on = new Dispatcher().oauth({...base, connectionOptional: true});
  const off = new Dispatcher().oauth({...base});
  assertEqual(fields(on).oauthResult.optional, true);
  assertEqual(fields(off).oauthResult.optional, false);
  assertEqual(fields(off).oauthResult.type, 'managed');
});

await test('configurableClient adds clientId (plain line) and clientSecret (line, not plain)', () => {
  const d = new Dispatcher().oauth({...base, configurableClient: true});
  assertEqual(fields(d).clientId.type, 'line');
  assertEqual(fields(d).clientId.plain, true);
  assertEqual(fields(d).clientSecret.type, 'line');
  assert(!fields(d).clientSecret.plain, 'clientSecret is not plain');
});

await test('configurableClient fields are optional exactly when configurableClientOptional is set', () => {
  const on = new Dispatcher().oauth({...base, configurableClient: true, configurableClientOptional: true});
  const off = new Dispatcher().oauth({...base, configurableClient: true});
  assertEqual([fields(on).clientId.optional, fields(on).clientSecret.optional], [true, true]);
  assertEqual([fields(off).clientId.optional, fields(off).clientSecret.optional], [false, false]);
});

await test('without configurableClient there are no client fields', () => {
  const d = new Dispatcher().oauth({...base, configurableClientOptional: true});
  assert(!('clientId' in fields(d)) && !('clientSecret' in fields(d)));
});

await test('configurableClientScope adds an optional, plain scope field whose description has the default scope', () => {
  const d = new Dispatcher().oauth({...base, configurableClientScope: 'read write'});
  const scope = fields(d).scope;
  assertEqual(scope.optional, true);
  assertEqual(scope.plain, true);
  assert(scope.description.includes('read write'), 'default scope text in description');
});

await test('without configurableClientScope there is no scope field', () => {
  const d = new Dispatcher().oauth({...base, configurableClient: true});
  assert(!('scope' in fields(d)));
});

await test('merge rule: fields defined through config() before oauth() keep their first definition', () => {
  const d = new Dispatcher();
  d.config({
    oauth: false,
    description: 'first description',
    summary: 'first summary',
    fields: {
      oauthResult: {name: 'mine', type: 'line'},
      clientId: {name: 'mine', type: 'line'},
      clientSecret: {name: 'mine', type: 'line'},
      scope: {name: 'mine', type: 'line'},
    },
  });
  d.oauth({...base, configurableClient: true, configurableClientScope: 'a'});
  for (const key of ['oauthResult', 'clientId', 'clientSecret', 'scope']) assertEqual(fields(d)[key], {name: 'mine', type: 'line'}, key);
  assertEqual(d._config.description, 'first description');
  assertEqual(d._config.summary, 'first summary');

  const e = new Dispatcher();
  e.config({oauth: true, description: 'd', summary: 's'});
  e.oauth({...base});
  assertEqual([e._config.oauth, e._config.description, e._config.summary], [true, 'd', 's']);
});

finish();
