// Tests for the connector test harness (src/testing) and, through it, the SDK's
// handshake, dispatch and result-return paths. No test reaches the network:
// the only sockets are on 127.0.0.1 and vendor HTTP is mocked.
import http from 'node:http';
import {describe, it, afterEach} from 'mocha';
import {expect} from 'chai';
import {Transport} from '../build/internal/websocket/transport/index.mjs';
import {Connector} from '../build/internal/connector/index.mjs';
import Fetcher from '../build/internal/fetcher/fetcher.mjs';
import {ConnectorHarness, FakeAloma, VendorMock} from '../build/testing/index.mjs';

const VENDOR = 'https://api.vendor.example.test';

// A tiny connector, wired the way the SDK wires a connector repo's controller.
function exampleConnector(seen = {}) {
  const connector = new Connector({id: 'example-connector', version: '1.2.3', name: 'Example Connector'});

  connector
    .configure()
    .config({
      fields: {
        apiKey: {name: 'API Key', type: 'line'},
        region: {name: 'Region', type: 'line', plain: true},
      },
    })
    .types('type Query { echo: String }')
    .resolvers({
      echo: async (args) => args,
      shout: async ({text}) => String(text).toUpperCase(),
      whoami: async (_args, ctx) => ({ctx}),
      nested: {deep: {method: async () => ({found: true})}},
      getItem: async ({id}) => {
        const client = seen.getClient({
          baseUrl: VENDOR,
          retry: 1,
          customize: (o) => {
            o.headers = {...o.headers, Authorization: `Bearer ${seen.config.apiKey}`};
          },
        });
        return client.fetch(`/items/${id}`, {method: 'GET'});
      },
      createItem: async (body) => {
        const client = seen.getClient({baseUrl: VENDOR, retry: 1});
        return client.fetch('/items', {method: 'POST', body});
      },
      forgottenMock: async () => new Fetcher({retry: 1}).fetch('https://not-mocked.example.test/x'),
      rawSocket: async () =>
        new Promise((resolve, reject) => {
          http.get('http://203.0.113.9/', () => resolve({reached: true})).on('error', reject);
        }),
      boom: async () => {
        throw new Error('kaput');
      },
      makeBlob: async () => ({id: await seen.createBlob({name: 'a.txt'})}),
    })
    .main((arg) => {
      seen.config = arg.config;
      seen.getClient = arg.getClient;
      seen.createBlob = arg.createBlob;
      seen.starts = (seen.starts || 0) + 1;
    });

  return connector;
}

describe('connector test harness', function () {
  this.timeout(15000);

  let harness;
  let seen;
  const realFetch = globalThis.fetch;

  const start = async (extra = {}) => {
    seen = {};
    harness = await ConnectorHarness.start({
      connector: exampleConnector(seen),
      config: {apiKey: 'fake-api-key-not-real', region: 'eu-test'},
      ...extra,
    });
    return harness;
  };

  afterEach(async () => {
    if (harness) await harness.stop({verify: false});
    harness = undefined;
  });

  describe('handshake', () => {
    it('registers, connects and opens the websocket', async () => {
      await start();
      const {aloma} = harness;

      expect(aloma.connected).to.equal(true);
      expect(aloma.registrations).to.have.length(1);
      expect(aloma.protocolErrors).to.deep.equal([]);
      // first connect has no token and is told to register (401), the second carries the issued token
      expect(aloma.connects.map((c) => c.authorized)).to.deep.equal([false, true]);
    });

    it('registers id, version, name, a public key and the schema', async () => {
      await start();
      const body = harness.aloma.registration;

      expect(body.id).to.equal('example-connector');
      expect(body.version).to.equal('1.2.3');
      expect(body.name).to.equal('Example Connector');
      expect(body.publicKey).to.be.a('string').with.length.greaterThan(100);
      expect(body.schema.configSchema.fields).to.have.keys('apiKey', 'region');
      expect(body.schema.introspect).to.equal('type Query { echo: String }');
      expect(harness.aloma.connects[1].headers['user-agent']).to.equal('example-connector/1.2.3');
    });

    it('delivers encrypted config decrypted and plain config as is, then runs main() once', async () => {
      await start();

      expect(seen.config).to.deep.equal({apiKey: 'fake-api-key-not-real', region: 'eu-test'});
      expect(seen.starts).to.equal(1);
    });

    it('answers connector.introspect with the schema and types', async () => {
      await start();
      const answer = await harness.aloma.introspect();

      expect(answer.introspect).to.equal('type Query { echo: String }');
      expect(answer.configSchema.fields.apiKey.name).to.equal('API Key');
    });

    it('can be started and stopped repeatedly without leaking state', async () => {
      for (let i = 0; i < 3; i++) {
        await start();
        expect(await harness.call('shout', {text: 'x'})).to.deep.equal({shout: 'X'});
        await harness.stop();
        harness = undefined;
      }
      expect(globalThis.fetch).to.equal(realFetch);
    });
  });

  describe('method calls', () => {
    it('round-trips an object result unchanged', async () => {
      await start();
      expect(await harness.call('echo', {a: 1, b: ['x']})).to.deep.equal({a: 1, b: ['x']});
    });

    it('wraps a non-object result under the method name', async () => {
      await start();
      expect(await harness.call('shout', {text: 'hello'})).to.deep.equal({shout: 'HELLO'});
    });

    it('resolves nested methods addressed by a path array', async () => {
      await start();
      expect(await harness.call(['nested', 'deep', 'method'])).to.deep.equal({found: true});
    });

    it('forwards taskId, namespace and sticky as ctx', async () => {
      await start();
      const answer = await harness.call('whoami', {}, {taskId: 't-1', namespace: 'ns', sticky: true});

      expect(answer.ctx).to.deep.equal({taskId: 't-1', namespace: 'ns', sticky: true});
    });

    it('answers concurrent calls independently', async () => {
      await start();
      const results = await Promise.all([1, 2, 3, 4, 5].map((n) => harness.call('echo', {n})));

      expect(results.map((r) => r.n)).to.deep.equal([1, 2, 3, 4, 5]);
    });

    it('serves connector-initiated requests through the fake endpoint (blobs)', async () => {
      await start();
      harness.aloma.handle('connector.blob.create', (args) => (args.name === 'a.txt' ? {id: 'blob-1'} : {error: 'bad'}));

      expect(await harness.call('makeBlob')).to.deep.equal({id: 'blob-1'});
    });
  });

  describe('vendor HTTP mock', () => {
    it('answers the connector vendor call from a recorded response', async () => {
      await start();
      harness.vendor.get(`${VENDOR}/items/7`, {json: {id: 7, name: 'recorded'}});

      expect(await harness.call('getItem', {id: 7})).to.deep.equal({id: 7, name: 'recorded'});
      expect(harness.vendor.requests).to.have.length(1);
      expect(harness.vendor.requests[0].headers.authorization).to.equal('Bearer fake-api-key-not-real');
    });

    it('lets a responder function see the request body and choose the reply', async () => {
      await start();
      harness.vendor.post(`${VENDOR}/items`, (req) => ({status: 201, json: {created: JSON.parse(req.body)}}));

      expect(await harness.call('createItem', {name: 'new'})).to.deep.equal({created: {name: 'new'}});
    });

    it('records the url the Fetcher really sends', async () => {
      await start();
      harness.vendor.get(`${VENDOR}/items/1`, {json: {}});
      await harness.call('getItem', {id: 1});

      // PINS SUSPECT BEHAVIOUR: Fetcher joins baseUrl + path and then collapses every run of slashes with
      // .replace(/\/\/+/g, '/'), so "https://host" becomes "https:/host". Node's URL parser repairs
      // this for http(s), but the same replace would also damage a "//" inside a query value.
      expect(harness.vendor.requests[0].url).to.equal('https://api.vendor.example.test/items/1');
      expect(harness.vendor.requests[0].rawUrl).to.equal('https:/api.vendor.example.test/items/1');
    });

    it('turns a vendor error status into a method error', async () => {
      await start();
      harness.vendor.get(/\/items\/9$/, {status: 404, text: 'no such item'});

      const answer = await harness.call('getItem', {id: 9});
      expect(answer.error).to.match(/404 no such item/);
    });

    it('rejects an unmocked request, reports it to the connector and fails the test on stop()', async () => {
      await start();
      const answer = await harness.call('forgottenMock');

      expect(answer.error).to.match(/UNMOCKED vendor request: GET https:\/\/not-mocked\.example\.test\/x/);
      expect(harness.vendor.unmocked).to.have.length(1);

      let failure;
      try {
        await harness.stop();
      } catch (e) {
        failure = e;
      }
      harness = undefined;
      expect(failure, 'stop() must fail when an unmocked request happened').to.be.instanceOf(Error);
      expect(failure.message).to.match(/UNMOCKED vendor requests/);
    });

    it('blocks raw sockets to non-loopback hosts even when fetch is bypassed', async () => {
      await start();
      const answer = await harness.call('rawSocket');

      expect(answer.error).to.match(/NETWORK BLOCKED/);
    });

    it('restores fetch and the network guard on stop()', async () => {
      await start();
      expect(globalThis.fetch).to.not.equal(realFetch);
      await harness.stop();
      harness = undefined;

      expect(globalThis.fetch).to.equal(realFetch);
    });

    it('limits a route with times and can assert every route was used', async () => {
      const vendor = new VendorMock();
      vendor.get('https://a.example.test/x', {json: {n: 1}}, {times: 1});
      vendor.get('https://b.example.test/never', {json: {}});
      vendor.install();
      try {
        const first = await globalThis.fetch('https://a.example.test/x');
        expect(await first.json()).to.deep.equal({n: 1});

        let failure;
        try {
          await globalThis.fetch('https://a.example.test/x');
        } catch (e) {
          failure = e;
        }
        expect(failure && failure.message).to.match(/UNMOCKED/);
        expect(() => vendor.verifyAllRoutesUsed()).to.throw(/never called/);
        expect(() => vendor.verify()).to.throw(/UNMOCKED/);
      } finally {
        vendor.uninstall();
      }
    });
  });

  describe('failing connectors', () => {
    it('reports a throwing method as an error answer and keeps serving', async () => {
      await start();

      expect(await harness.call('boom')).to.deep.equal({error: 'Error: kaput'});
      expect(await harness.call('shout', {text: 'still up'})).to.deep.equal({shout: 'STILL UP'});
    });

    it('reports an unknown method as an error answer', async () => {
      await start();
      const answer = await harness.call('doesNotExist');

      expect(answer.error).to.match(/doesNotExist not found/);
    });

    it('callOk() throws when the connector answered with an error', async () => {
      await start();
      let failure;
      try {
        await harness.callOk('boom');
      } catch (e) {
        failure = e;
      }
      expect(failure.message).to.match(/boom failed: Error: kaput/);
    });

    it('fails start() with the cause when main() throws', async () => {
      const connector = new Connector({id: 'broken-main', version: '0.0.1', name: 'Broken'});
      connector
        .configure()
        .config({fields: {k: {name: 'K', type: 'line'}}})
        .types('type Query { x: String }')
        .resolvers({x: async () => 1})
        .main(() => {
          throw new Error('cannot start');
        });

      let failure;
      try {
        await ConnectorHarness.start({connector, config: {k: 'v'}});
      } catch (e) {
        failure = e;
      }
      expect(failure && failure.message).to.equal('cannot start');
    });
  });

  describe('pinned SDK behaviour', () => {
    it('Transport.close() never terminates the websocket', () => {
      // PINS SUSPECT BEHAVIOUR: Transport.close() calls local.ws.terminate(), but `local` is not defined in
      // close() (it is only defined in the other methods). The ReferenceError is swallowed by the try/catch,
      // so close() clears its timers and flags but leaves the socket open. Today a closed connector relies on
      // the server side (or process exit) to drop the connection.
      const transport = new Transport({config: {}, onMessage() {}, onConnect() {}});
      let terminated = false;
      transport.ws = {terminate: () => (terminated = true)};

      transport.close();

      expect(transport.running).to.equal(false);
      expect(transport.connected).to.equal(false);
      expect(terminated).to.equal(false);
    });
  });

  describe('fake ALOMA strictness', () => {
    let aloma;
    afterEach(async () => aloma && (await aloma.close()));

    it('refuses registration with a wrong registration token and records it', async () => {
      aloma = await FakeAloma.start();
      const response = await fetch(`${aloma.url}register`, {
        method: 'POST',
        body: '{}',
        headers: {Authorization: 'Connector wrong-token'},
      });

      expect(response.status).to.equal(401);
      expect(aloma.protocolErrors.join()).to.match(/wrong registration token/);
    });

    it('answers /connect with 401 until a token was issued by registering', async () => {
      aloma = await FakeAloma.start();
      const response = await fetch(`${aloma.url}connect`, {
        method: 'POST',
        body: '{}',
        headers: {Authorization: 'Connector null'},
      });

      expect(response.status).to.equal(401);
    });

    it('times out with a diagnostic when no connector connects', async () => {
      aloma = await FakeAloma.start();
      let failure;
      try {
        await aloma.waitForConnection(50);
      } catch (e) {
        failure = e;
      }
      expect(failure.message).to.match(/did not connect within 50ms/);
    });
  });
});
