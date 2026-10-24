// Handshake smoke test: the one file a connector repo adds (see "Testing a connector" in the SDK README).
//
// In a connector repo the RuntimeContext comes from the repo's own builder after `yarn build`:
//     const context = await new Builder().config({...}).build();
// Here the controller is defined inline so this file also tests the harness path used by connector repos.
import {describe, it, afterEach} from 'mocha';
import {expect} from 'chai';
import {AbstractController} from '../build/index.mjs';
import RuntimeContext from '../build/builder/runtime-context.mjs';
import {ConnectorHarness, connectorFromRuntimeContext} from '../build/testing/index.mjs';

const VENDOR = 'https://api.crm.example.test';

class Controller extends AbstractController {
  async getContact({id}) {
    return this.getClient({baseUrl: VENDOR, retry: 1, customize: (r) => {
      r.headers = {...r.headers, Authorization: `Bearer ${this.config.apiKey}`};
    }}).fetch(`/contacts/${id}`, {method: 'GET'});
  }
}

const context = () =>
  new RuntimeContext(new Controller(), {
    id: 'crm-connector',
    version: '0.0.1',
    methods: ['getContact'],
    types: 'type Query { getContact(id: String): String }',
    config: {fields: {apiKey: {name: 'API Key', type: 'line'}}},
  });

describe('crm-connector handshake smoke test', function () {
  this.timeout(15000);
  let harness;

  afterEach(async () => {
    // stop() also fails the test when the connector made a request that was not mocked
    if (harness) await harness.stop();
    harness = undefined;
  });

  it('registers, connects, starts and reports healthy', async () => {
    harness = await ConnectorHarness.start({
      connector: connectorFromRuntimeContext(context()),
      config: {apiKey: 'fake-api-key-not-real'},
    });

    expect(harness.aloma.registration.id).to.equal('crm-connector');
    expect(harness.aloma.registration.schema.configSchema.fields).to.have.property('apiKey');

    const health = await harness.aloma.waitForPacket('connector.health.check');
    expect(health.a).to.deep.equal({ok: true, error: null});
  });

  it('answers a method call from a recorded vendor response', async () => {
    harness = await ConnectorHarness.start({
      connector: connectorFromRuntimeContext(context()),
      config: {apiKey: 'fake-api-key-not-real'},
    });
    harness.vendor.get(`${VENDOR}/contacts/42`, {json: {id: 42, email: 'jane@example.test'}});

    expect(await harness.callOk('getContact', {id: 42})).to.deep.equal({id: 42, email: 'jane@example.test'});
    expect(harness.vendor.requests[0].headers.authorization).to.equal('Bearer fake-api-key-not-real');
  });

  it('reports a missing configuration value as unhealthy', async () => {
    harness = await ConnectorHarness.start({connector: connectorFromRuntimeContext(context()), config: {}});

    const health = await harness.aloma.waitForPacket('connector.health.check');
    expect(health.a.ok).to.equal(false);
    expect(health.a.error).to.match(/API Key is required/);
  });
});
