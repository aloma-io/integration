// PLAT-23: JWE config decryption (util/jwe, Config.validateKeys, decryptConfig). Standalone script (no mocha). Every
// key is generated here at run time and exists only in this process; nothing is committed or sent anywhere.
// Tests marked "pins current behaviour" fix it as it is now, so a deliberate change to it updates the test with it.
import crypto from 'node:crypto';
import * as jose from 'jose';
import JWE from '../build/internal/util/jwe/index.mjs';
import {Config} from '../build/internal/websocket/config.mjs';
import {decryptConfig} from '../build/internal/connector/server/on-connect/decrypt-config.mjs';
import {assert, assertEqual, captureLog, outcome, suite} from './helpers/mini.mjs';

const {test, finish} = suite('JWE config');

const AUD = 'connector-1';
const newJwe = async () => {
  const jwe = new JWE({algorithm: 'RSA-OAEP-256'});
  await jwe.newPair();
  return jwe;
};
const b64 = (s) => Buffer.from(s).toString('base64');
const configFor = async (jwe, id = AUD) => {
  const pair = await jwe.exportPair();
  return new Config({
    registrationToken: 'test-registration',
    version: '1.0.0',
    name: 'test',
    id,
    endpoint: 'http://127.0.0.1:1',
    wsEndpoint: 'ws://127.0.0.1:1',
    privateKey: b64(pair.privateKey),
    publicKey: b64(pair.publicKey),
    configSchema: () => ({fields: {}}),
  });
};
const rejected = async (promise) => (await outcome(promise)).error;
// flip one character in the middle of one of the five dot-separated parts of a compact JWE
const tamper = (token, index) => {
  const parts = token.split('.');
  const p = parts[index];
  const at = Math.floor(p.length / 2);
  parts[index] = p.slice(0, at) + (p[at] === 'A' ? 'B' : 'A') + p.slice(at + 1);
  return parts.join('.');
};

// --- decrypt with the right key (jwe/index.mts:50-69) ---

await test('a token decrypts with the right key, for the right audience, to the original data', async () => {
  const jwe = await newJwe();
  const token = await jwe.encrypt({a: 1, nested: {b: 'x'}}, '7d', AUD);
  assertEqual(await jwe.decrypt(token, AUD), {a: 1, nested: {b: 'x'}}, 'data');
});

await test('the token is a five-part JWE with RSA-OAEP-256 / A256GCM, issuer, audience and expiry set', async () => {
  const jwe = await newJwe();
  const token = await jwe.encrypt({a: 1}, '2h', AUD);
  assertEqual(token.split('.').length, 5, 'compact JWE parts');
  const {payload, protectedHeader} = await jose.jwtDecrypt(token, jwe.pair.privateKey);
  assertEqual([protectedHeader.alg, protectedHeader.enc], ['RSA-OAEP-256', 'A256GCM'], 'algorithms');
  assertEqual([payload.iss, payload.aud], ['home.aloma.io', AUD], 'iss and aud');
  assertEqual(payload.exp - payload.iat, 7200, 'expiry');
  assert(!token.includes(Buffer.from('"a":1').toString('base64').slice(0, 6)), 'payload is not readable in the token');
});

await test('expiration "none" (and no expiration) gives a token without exp that still decrypts', async () => {
  const jwe = await newJwe();
  for (const expiration of ['none', '']) {
    const token = await jwe.encrypt({a: 1}, expiration, AUD);
    const {payload} = await jose.jwtDecrypt(token, jwe.pair.privateKey);
    assertEqual(payload.exp, undefined, `exp for "${expiration}"`);
    assertEqual(await jwe.decrypt(token, AUD), {a: 1}, 'data');
  }
});

await test('a token without _data decrypts to undefined', async () => {
  const jwe = await newJwe();
  const token = await new jose.EncryptJWT({other: 1})
    .setProtectedHeader({alg: 'RSA-OAEP-256', enc: 'A256GCM'})
    .setIssuer('home.aloma.io')
    .setAudience(AUD)
    .encrypt(jwe.pair.publicKey);
  assertEqual(await jwe.decrypt(token, AUD), undefined, 'data');
});

await test('an exported key pair can be imported again and decrypts what the first one encrypted', async () => {
  const jwe = await newJwe();
  const pair = await jwe.exportPair();
  assert(pair.publicKey.startsWith('-----BEGIN PUBLIC KEY-----'), 'SPKI');
  assert(pair.privateKey.startsWith('-----BEGIN PRIVATE KEY-----'), 'PKCS8');
  const other = new JWE({});
  await other.importPair({...pair, algorithm: 'RSA-OAEP-256'});
  assertEqual(await other.decrypt(await jwe.encrypt({a: 1}, '1h', AUD), AUD), {a: 1}, 'data');
  assertEqual(await jwe.exportPrivateAsBase64(), b64(pair.privateKey), 'base64 private');
  assertEqual(await jwe.exportPublicAsBase64(), b64(pair.publicKey), 'base64 public');
});

// --- refused tokens ---

await test('a wrong key cannot decrypt', async () => {
  const jwe = await newJwe();
  const stranger = await newJwe();
  const error = await rejected(stranger.decrypt(await jwe.encrypt({a: 1}, '1h', AUD), AUD));
  assertEqual(error?.code, 'ERR_JWE_DECRYPTION_FAILED', 'error code');
});

await test('a token with any one of its five parts changed is refused', async () => {
  const jwe = await newJwe();
  const token = await jwe.encrypt({a: 1}, '1h', AUD);
  const names = ['protected header', 'encrypted key', 'iv', 'ciphertext', 'authentication tag'];
  for (let i = 0; i < 5; ++i) {
    const error = await rejected(jwe.decrypt(tamper(token, i), AUD));
    assert(error, `${names[i]} changed, but the token was accepted`);
  }
});

await test('a token with a part dropped or added, an empty string or garbage is refused', async () => {
  const jwe = await newJwe();
  const token = await jwe.encrypt({a: 1}, '1h', AUD);
  const parts = token.split('.');
  for (const bad of [parts.slice(0, 4).join('.'), token + '.x', '', 'not-a-token', parts.map(() => '').join('.')]) {
    assert(await rejected(jwe.decrypt(bad, AUD)), `accepted: "${bad.slice(0, 30)}"`);
  }
});

await test('an expired token is refused with a JWTExpired error', async () => {
  const jwe = await newJwe();
  const token = await jwe.encrypt({a: 1}, '-1h', AUD);
  const error = await rejected(jwe.decrypt(token, AUD));
  assertEqual(error?.code, 'ERR_JWT_EXPIRED', 'error code');
});

await test('a token for another audience or from another issuer is refused', async () => {
  const jwe = await newJwe();
  assertEqual((await rejected(jwe.decrypt(await jwe.encrypt({a: 1}, '1h', 'other-connector'), AUD)))?.code, 'ERR_JWT_CLAIM_VALIDATION_FAILED', 'audience');
  const foreign = await new jose.EncryptJWT({_data: {a: 1}})
    .setProtectedHeader({alg: 'RSA-OAEP-256', enc: 'A256GCM'})
    .setIssuer('evil.example.test')
    .setAudience(AUD)
    .encrypt(jwe.pair.publicKey);
  assertEqual((await rejected(jwe.decrypt(foreign, AUD)))?.code, 'ERR_JWT_CLAIM_VALIDATION_FAILED', 'issuer');
});

await test('a token with a symmetric key-management algorithm (dir, A256KW) is refused by the RSA key', async () => {
  const jwe = await newJwe();
  const secret = crypto.randomBytes(32);
  for (const alg of ['dir', 'A256KW']) {
    const token = await new jose.EncryptJWT({_data: {a: 1}})
      .setProtectedHeader({alg, enc: 'A256GCM'})
      .setIssuer('home.aloma.io')
      .setAudience(AUD)
      .encrypt(secret);
    assert(await rejected(jwe.decrypt(token, AUD)), `${alg} accepted`);
  }
});

await test('an unsigned or signed (JWS) token is refused', async () => {
  const jwe = await newJwe();
  const jws = await new jose.SignJWT({_data: {a: 1}})
    .setProtectedHeader({alg: 'PS256'})
    .setIssuer('home.aloma.io')
    .setAudience(AUD)
    .sign(jwe.pair.privateKey);
  const unsecured = new jose.UnsecuredJWT({_data: {a: 1}}).setIssuer('home.aloma.io').setAudience(AUD).encode();
  for (const token of [jws, unsecured]) assert(await rejected(jwe.decrypt(token, AUD)), 'accepted');
});

await test('only RSA-OAEP-256 with A256GCM is accepted: another content encryption or key-management algorithm is refused', async () => {
  const jwe = await newJwe();
  for (const [alg, enc] of [['RSA-OAEP-256', 'A128GCM'], ['RSA-OAEP-256', 'A256CBC-HS512'], ['RSA-OAEP', 'A256GCM'], ['RSA-OAEP-384', 'A256GCM']]) {
    const token = await new jose.EncryptJWT({_data: {a: 1}})
      .setProtectedHeader({alg, enc})
      .setIssuer('home.aloma.io')
      .setAudience(AUD)
      .encrypt(jwe.pair.publicKey);
    assert(await rejected(jwe.decrypt(token, AUD)), `${alg} / ${enc} accepted`);
  }
});

await test('pins current behaviour: anyone holding the public key can mint a config the connector accepts (no sender proof)', async () => {
  // the token is encrypted, not signed: jwe/index.mts:50-60. Only the authenticated transport says who sent it.
  const jwe = await newJwe();
  const pair = await jwe.exportPair();
  const attacker = new JWE({});
  attacker.pair = {publicKey: await jose.importSPKI(pair.publicKey, 'RSA-OAEP-256')};
  const forged = await attacker.encrypt({apiKey: 'attacker-value'}, '1h', AUD);
  assertEqual(await jwe.decrypt(forged, AUD), {apiKey: 'attacker-value'}, 'accepted');
});

// --- Config.validateKeys (websocket/config.mjs:40-49) ---

await test('validateKeys needs both keys', async () => {
  const jwe = await newJwe();
  const config = await configFor(jwe);
  config._privateKey = undefined;
  assertEqual((await rejected(config.validateKeys('RSA-OAEP-256')))?.message, 'need private and public key', 'message');
});

await test('validateKeys loads the base64 pair so that the connector can decrypt', async () => {
  const jwe = await newJwe();
  const config = await configFor(jwe);
  const loaded = await config.validateKeys('RSA-OAEP-256');
  assertEqual(await loaded.decrypt(await jwe.encrypt({a: 1}, '1h', AUD), AUD), {a: 1}, 'data');
});

await test('validateKeys refuses keys that cannot be read, so the "keys could not be loaded" help is reached', async () => {
  const jwe = await newJwe();
  for (const field of ['_privateKey', '_publicKey']) {
    const config = await configFor(jwe);
    config[field] = b64('this is not a key');
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const error = await rejected(config.validateKeys('RSA-OAEP-256'));
    await new Promise((r) => setTimeout(r, 200));
    process.off('unhandledRejection', onUnhandled);
    assert(error, `${field}: validateKeys resolved`);
    assertEqual(unhandled.length, 0, `${field}: unhandled rejections`);
  }
});

// --- decryptConfig (on-connect/decrypt-config.mts) ---

const schema = (fields = {}) => () => ({fields});

await test('decryptConfig decrypts every secret for the connector id, passes plain fields and endpointUrl through, skips empty ones', async () => {
  const jwe = await newJwe();
  const config = await configFor(jwe);
  const result = await decryptConfig({
    configSchema: schema({label: {plain: true}}),
    config,
    secrets: {
      apiKey: await jwe.encrypt({v: 'k1'}, '7d', AUD),
      label: 'plain label',
      endpointUrl: 'http://127.0.0.1:9',
      empty: '',
    },
  });
  assertEqual(result, {apiKey: {v: 'k1'}, label: 'plain label', endpointUrl: 'http://127.0.0.1:9'}, 'decrypted');
});

await test('decryptConfig drops a value that fails to decrypt (wrong key, tampered, expired, wrong audience) and keeps the rest', async () => {
  const jwe = await newJwe();
  const stranger = await newJwe();
  const config = await configFor(jwe);
  const good = await jwe.encrypt({v: 'good'}, '7d', AUD);
  const values = {
    good,
    wrongKey: await stranger.encrypt({v: 1}, '7d', AUD),
    tampered: tamper(good, 3),
    expired: await jwe.encrypt({v: 1}, '-1h', AUD),
    wrongAudience: await jwe.encrypt({v: 1}, '7d', 'other'),
  };
  const {result} = await captureLog(() => decryptConfig({configSchema: schema(), config, secrets: values}));
  assertEqual(result, {good: {v: 'good'}}, 'only the good value is kept');
});

await test('decryptConfig drops a value with another algorithm pair and keeps the RSA-OAEP-256 / A256GCM one', async () => {
  const jwe = await newJwe();
  const config = await configFor(jwe);
  const other = await new jose.EncryptJWT({_data: {v: 1}})
    .setProtectedHeader({alg: 'RSA-OAEP-256', enc: 'A128GCM'})
    .setIssuer('home.aloma.io')
    .setAudience(AUD)
    .encrypt(jwe.pair.publicKey);
  const values = {good: await jwe.encrypt({v: 'good'}, '7d', AUD), other};
  const {result, lines} = await captureLog(() => decryptConfig({configSchema: schema(), config, secrets: values}));
  assertEqual(result, {good: {v: 'good'}}, 'only the RSA-OAEP-256 / A256GCM value is kept');
  assert(lines.some((l) => l.includes('failed to decrypt key') && l.includes('other')), `log: ${lines.join(' | ')}`);
});

await test('a decryption failure is logged with the key name and no token, no key and no payload', async () => {
  const jwe = await newJwe();
  const config = await configFor(jwe);
  const pair = await jwe.exportPair();
  const good = await jwe.encrypt({v: 'payload-value-123'}, '7d', AUD);
  const bad = tamper(good, 4);
  const { lines } = await captureLog(() => decryptConfig({configSchema: schema(), config, secrets: {apiKey: bad}}));
  assert(lines.some((l) => l.includes('failed to decrypt key') && l.includes('apiKey')), `log: ${lines.join(' | ')}`);
  const private64 = b64(pair.privateKey);
  for (const secret of [bad, good, 'payload-value-123', private64, pair.privateKey.split('\n')[1]]) {
    assert(!lines.some((l) => l.includes(secret)), `secret material in the log: ${secret.slice(0, 20)}...`);
  }
  assert(lines.some((l) => l.includes('***')) || !lines.some((l) => l.includes(bad)), 'token masked');
});

await test('the token is masked as *** where a library error message would have quoted it', async () => {
  // decrypt-config.mts:20 replaces the value inside the error text; a stub key makes jose-independent text visible
  const config = {id: () => AUD, validateKeys: async () => ({decrypt: async (v) => { throw new Error(`cannot read ${v}`); }})};
  const { lines } = await captureLog(() =>
    decryptConfig({configSchema: schema(), config, secrets: {apiKey: 'tok.en.value'}})
  );
  assert(lines.some((l) => l.includes('cannot read ***')), `log: ${lines.join(' | ')}`);
  assert(!lines.some((l) => l.includes('tok.en.value')), 'token in the log');
});

finish();
