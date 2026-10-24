import {Config} from '../internal/websocket/config.mjs';
import {WebsocketConnector} from '../internal/websocket/index.mjs';
import {onConnect} from '../internal/connector/server/on-connect/index.mjs';
import {onMessage} from '../internal/connector/server/on-message.mjs';
import type {Connector} from '../internal/connector/index.mjs';
import {FakeAloma} from './fake-aloma.mjs';
import {testKeyPair} from './keys.mjs';
import {VendorMock} from './vendor-mock.mjs';

export type HarnessOptions = {
  /**
   * The connector under test, already configured:
   * `const c = new Connector({id, version, name}); c.configure().types(...).resolvers(...).main(...)`
   */
  connector: Connector;
  /** vendor mock; a fresh one is created when omitted */
  vendor?: VendorMock;
  /**
   * configuration values ALOMA sends after the handshake (encrypted unless the field is `plain`).
   * `null` skips sending any configuration (the connector then never starts its main()).
   */
  config?: Record<string, any> | null;
  /** how long to wait for each step, ms */
  timeoutMs?: number;
};

/**
 * Runs a real connector against a fake ALOMA, in-process.
 *
 * It wires the same SDK parts as Connector.run() and makeServer(): Config, WebsocketConnector (connection,
 * registration, transport), onConnect (config decryption, main()), onMessage (dispatch and reply).
 * Left out on purpose: the Prometheus metrics server (fixed port 4050), process signal handlers and
 * env-var configuration, which are global side effects that cannot run once per test.
 */
export class ConnectorHarness {

  private constructor(
    readonly aloma: FakeAloma,
    readonly vendor: VendorMock,
    private readonly server: WebsocketConnector,
    private readonly started: Promise<void> | null
  ) {}

  static async start(options: HarnessOptions): Promise<ConnectorHarness> {
    const {connector, timeoutMs = 5000} = options;
    const dispatcher: any = connector.dispatcher;
    if (!dispatcher) throw new Error('call connector.configure() before starting the harness');

    const vendor = options.vendor || new VendorMock();
    const aloma = await FakeAloma.start();
    vendor.allowPassthrough((url) => url.origin === new URL(aloma.url).origin);
    vendor.install();

    // main() is what a connector runs once ALOMA has sent its configuration; observe it
    let mainDone!: () => void;
    let mainFailed!: (e: unknown) => void;
    const started = new Promise<void>((resolve, reject) => {
      mainDone = resolve;
      mainFailed = reject;
    });
    started.catch(() => {});

    const originalMain = dispatcher._main;
    dispatcher.main(async (arg) => {
      try {
        await originalMain?.(arg);
        mainDone();
      } catch (e) {
        mainFailed(e);
        throw e;
      }
    });

    let server: WebsocketConnector | undefined;

    try {
      const {processPacket, start, introspect, configSchema} = dispatcher.build();
      const keys = await testKeyPair();

      const config = new Config({
        id: connector.id,
        version: connector.version,
        name: connector.name,
        registrationToken: aloma.registrationToken,
        endpoint: aloma.url,
        wsEndpoint: aloma.wsUrl,
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
        introspect,
        configSchema,
        icon: connector.icon,
      });

      server = new WebsocketConnector({
        config,
        onConnect: onConnect({config, configSchema, dispatcher, start}),
        onMessage: onMessage(processPacket),
      });

      const harness = new ConnectorHarness(aloma, vendor, server, options.config === null ? null : started);

      await server.start();
      await aloma.waitForConnection(timeoutMs);

      if (options.config !== null) {
        await aloma.setConfig(options.config || {});
        await withTimeout(started, timeoutMs, 'connector main() did not finish after the configuration was sent');
      }

      return harness;
    } catch (e) {
      await ConnectorHarness.shutdown(server, vendor, aloma);
      throw e;
    }
  }

  private static async shutdown(server: WebsocketConnector | undefined, vendor: VendorMock, aloma: FakeAloma) {
    try {
      if (server) {
        const anyServer: any = server;

        await anyServer.leaving();
        await anyServer.close();

        // the SDK leaves a 45s ping watchdog timer behind; clear it so a test run can exit
        clearTimeout(anyServer.transport?.ws?.pingTimeout);
      }
    } finally {
      vendor.uninstall();
      await aloma.close();
    }
  }

  /** call a connector method and return the raw answer (`{error}` when it failed) */
  call(method: string | string[], variables?: any, ctx?: {taskId?: string; namespace?: string; sticky?: boolean}) {
    return this.aloma.call(method, variables, ctx);
  }

  /** call a connector method; throws when the connector answered with an error */
  async callOk(method: string | string[], variables?: any) {
    const answer = await this.call(method, variables);
    if (answer?.error) throw new Error(`${method} failed: ${answer.error}`);

    return answer;
  }

  /**
   * Shut down the connector and the fake endpoint, restore fetch and the network guard.
   * Then fails if the connector made any request that was not mocked or the fake endpoint saw a protocol error.
   */
  async stop({verify = true}: {verify?: boolean} = {}) {
    await ConnectorHarness.shutdown(this.server, this.vendor, this.aloma);

    if (verify) {
      this.vendor.verify();
      if (this.aloma.protocolErrors.length) {
        throw new Error(`protocol errors seen by the fake ALOMA: ${JSON.stringify(this.aloma.protocolErrors)}`);
      }
    }
  }
}

const withTimeout = <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: NodeJS.Timeout;

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};
