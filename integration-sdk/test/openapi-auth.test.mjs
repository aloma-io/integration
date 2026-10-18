// The hand-written auth part of generated connectors: OAuth through the SDK runtime, or an access token
// from the connector's configuration. All requests go to local stubs; the network is blocked.
import {assertNoNetwork, withFetch} from './support/offline.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {OpenAPIToConnector} from '../build/openapi-to-connector.mjs';
import {Builder, configureAuth, clientAuth, hubspotAuth} from '../build/index.mjs';
import Fetcher from '../build/internal/fetcher/fetcher.mjs';
import {OAuth} from '../build/internal/fetcher/oauth-fetcher.mjs';
import {loadConnector} from './support/load-generated.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const specText = fs.readFileSync(path.join(here, 'fixtures/example-crm.json'), 'utf-8');

const colors = {green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', reset: '\x1b[0m', cyan: '\x1b[36m'};
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    console.log(`${colors.cyan}Running: ${name}${colors.reset}`);
    await fn();
    assertNoNetwork();
    console.log(`${colors.green}✓ PASS: ${name}${colors.reset}\n`);
    passed++;
  } catch (error) {
    console.log(`${colors.red}✗ FAIL: ${name}${colors.reset}`);
    console.log(`${colors.red}  Error: ${error.message}${colors.reset}\n`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

const plan = {
  oauth: {
    authorizationURL: 'https://auth.example.test/authorize?client_id={{clientId}}&redirect_uri={{redirectURI}}&scope={{scope}}',
    tokenURL: 'https://auth.example.test/token',
    scope: 'contacts.read contacts.write',
  },
  token: {field: 'apiToken', name: 'Access token'},
};

// Sends one request through a client and returns the headers it carried. The response comes from a stub.
async function headersSent(client) {
  let headers;
  await withFetch(async (url, options) => {
    headers = options.headers;
    return new Response('{}', {status: 200, headers: {'Content-Type': 'application/json'}});
  }, () => client.fetch('/x', {method: 'GET'}));
  return headers;
}

const noRefresh = async () => {
  throw new Error('token refresh must not be called');
};

// --- Builder configuration ---

await test('configureAuth declares OAuth and an access-token field to the connector builder', async () => {
  const builder = new Builder();
  configureAuth(builder, plan, {summary: 'Example CRM'});
  const data = builder['data'];
  assert(data.auth?.oauth?.tokenURL === 'https://auth.example.test/token', JSON.stringify(data.auth));
  assert(data.auth.oauth.authorizationURL.includes('{{scope}}'), 'scope placeholder missing');
  assert(data.auth.oauth.scope === 'contacts.read contacts.write', 'scope missing');
  assert(data.auth.oauth.connectionOptional === true, 'with a token alternative, the OAuth connection must be optional');
  const field = data.config?.fields?.apiToken;
  assert(field && field.type === 'line' && field.optional === true, JSON.stringify(data.config));
  assert(data.config.summary === 'Example CRM', 'summary missing');
});

await test('a token-only plan declares a required field and no OAuth', async () => {
  const builder = new Builder();
  configureAuth(builder, {token: {field: 'apiKey', name: 'API key'}});
  assert(!builder['data'].auth?.oauth, 'OAuth declared');
  assert(builder['data'].config.fields.apiKey.optional !== true, 'token field must be required');
});

// --- Client: which credential a request carries ---

await test('with OAuth connected and no token configured, requests carry the OAuth access token', async () => {
  const oauth = new OAuth({access_token: 'oauth-access'}, async () => {}, noRefresh);
  const client = oauth.getClient({baseUrl: 'https://api.example.test', ...clientAuth(plan, {})});
  const headers = await headersSent(client);
  assert(headers.Authorization === 'Bearer oauth-access', JSON.stringify(headers));
});

await test('with a configured token, requests carry the token and OAuth is not used', async () => {
  const oauth = new OAuth({}, async () => {}, noRefresh);
  const client = oauth.getClient({baseUrl: 'https://api.example.test', ...clientAuth(plan, {apiToken: 'private-token'})});
  const headers = await headersSent(client);
  assert(headers.Authorization === 'Bearer private-token', JSON.stringify(headers));
});

await test('a token-only connector sends the token as a bearer header', async () => {
  const client = new Fetcher({baseUrl: 'https://api.example.test', ...clientAuth({token: {field: 'apiKey', name: 'API key'}}, {apiKey: 'k1'})});
  const headers = await headersSent(client);
  assert(headers.Authorization === 'Bearer k1', JSON.stringify(headers));
});

await test('a token-only connector with no token refuses the request before it is sent', async () => {
  let sent = 0;
  const client = new Fetcher({baseUrl: 'https://api.example.test', retry: 1, ...clientAuth({token: {field: 'apiKey', name: 'API key'}}, {})});
  let error;
  await withFetch(async () => {
    sent++;
    return new Response('{}', {status: 200});
  }, async () => {
    try {
      await client.fetch('/x', {method: 'GET'});
    } catch (e) {
      error = e;
    }
  });
  assert(error && /API key/.test(error.message), `expected an error naming the missing API key, got ${error?.message}`);
  assert(sent === 0, `${sent} requests sent`);
});

// --- HubSpot preset ---

await test('the HubSpot preset uses HubSpot OAuth with the scopes of the existing connector, or a private app token', async () => {
  assert(hubspotAuth.oauth.tokenURL === 'https://api.hubapi.com/oauth/v1/token', hubspotAuth.oauth.tokenURL);
  assert(hubspotAuth.oauth.authorizationURL.startsWith('https://app.hubspot.com/oauth/authorize?'), hubspotAuth.oauth.authorizationURL);
  for (const placeholder of ['{{clientId}}', '{{redirectURI}}', '{{scope}}']) {
    assert(hubspotAuth.oauth.authorizationURL.includes(placeholder), `missing ${placeholder}`);
  }
  assert(
    hubspotAuth.oauth.scope ===
      'oauth crm.lists.read crm.objects.contacts.read crm.objects.contacts.write crm.schemas.contacts.read crm.lists.write crm.schemas.contacts.write',
    hubspotAuth.oauth.scope
  );
  assert(hubspotAuth.oauth.additionalTokenArgs?.grant_type === 'authorization_code', 'grant type');
  assert(hubspotAuth.token.field === 'apiToken', 'token field');
});

// --- Generated connectors use the hand-written auth module ---

await test('a generated controller takes its credentials from the hand-written auth module', async () => {
  const gen = new OpenAPIToConnector(OpenAPIToConnector.parseSpec(specText), 'Example CRM', {authModule: '../auth.mjs'});
  const auth = OpenAPIToConnector.authModuleStub();
  let clientArgs;
  const c = await loadConnector(
    {'controller/index.mts': gen.generateController(), 'auth.mts': auth},
    {
      config: {apiToken: 't-1'},
      getClient: (arg) => {
        clientArgs = arg;
        return {fetch: async () => ({ok: true})};
      },
    }
  );
  assert(!c.meta.error, c.meta.error);
  assert(clientArgs.baseUrl === 'https://api.example.test', JSON.stringify(clientArgs));
  const request = {headers: {}};
  await clientArgs.customize(request);
  assert(request.headers.Authorization === 'Bearer t-1', JSON.stringify(request));
});

await test('the auth stub is plain hand-written code that names its credential', async () => {
  const stub = OpenAPIToConnector.authModuleStub();
  assert(/Hand-written/.test(stub), 'stub does not say it is hand-written');
  assert(/export default/.test(stub) && /AuthPlan/.test(stub), stub);
});

console.log(`\n${colors.yellow}===== Results =====${colors.reset}`);
console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${failed}${colors.reset}`);

if (failed > 0) {
  process.exit(1);
}
