import {randomUUID} from 'node:crypto';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import * as jose from 'jose';
import {WebSocket, WebSocketServer} from 'ws';

type Packet = {id?: string; m?: string; c?: string; a?: any; e?: any};

/**
 * A fake ALOMA endpoint that speaks the connector protocol, in-process on a loopback port.
 *
 * Protocol (taken from src/internal/websocket and src/internal/dispatcher):
 *  1. POST {url}connect with `Authorization: Connector <token>`. 401 means "register first", 200 + json means connected.
 *  2. POST {url}register with `Authorization: Connector <registrationToken>` and
 *     {name, version, id, publicKey, schema:{configSchema, introspect}, icon}; answer 200 {key: <token>}.
 *  3. The connector opens a websocket at wsUrl (subprotocol "connector", same Authorization header).
 *  4. Both sides exchange text frames {p: [packet, ...]}; a packet is {id, m: method, c: callback key, a: args}.
 *  5. ALOMA sends connector.set-config {secrets} (no reply), then connector.query {query, variables} with a
 *     callback key; the connector answers {c: key, a: result} or {c: key, a: {error}}.
 *
 * Anything that does not look like the real protocol is recorded in `protocolErrors`.
 */
export class FakeAloma {
  readonly registrationToken = `fake-registration-${randomUUID()}`;
  readonly sessionToken = `fake-session-${randomUUID()}`;

  /** bodies of POST /register */
  readonly registrations: any[] = [];
  /** headers of POST /connect */
  readonly connects: Array<{authorized: boolean; headers: http.IncomingHttpHeaders}> = [];
  /** every packet the connector sent over the websocket, in order */
  readonly received: Packet[] = [];
  readonly protocolErrors: string[] = [];

  private server!: http.Server;
  private wss!: WebSocketServer;
  private socket?: WebSocket;
  private pending = new Map<string, (args: any) => void>();
  private handlers = new Map<string, (args: any) => any | Promise<any>>();
  private waiters: Array<() => void> = [];
  private port = 0;
  private id = '';
  private version = '';

  static async start(): Promise<FakeAloma> {
    const fake = new FakeAloma();
    await fake.listen();

    return fake;
  }

  /** value for the connector's endpoint setting (env.DEVICE_ENDPOINT) */
  get url() {
    return `http://127.0.0.1:${this.port}/`;
  }

  /** value for the connector's websocket setting (env.WEBSOCKET_ENDPOINT) */
  get wsUrl() {
    return `ws://127.0.0.1:${this.port}/transport/`;
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get registration() {
    return this.registrations[this.registrations.length - 1];
  }

  private async listen() {
    this.server = http.createServer((req, res) => {
      this.onHttp(req, res).catch((e) => {
        this.protocolErrors.push(`http handler failed: ${e}`);
        res.writeHead(500).end();
      });
    });

    this.wss = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols) => (protocols.has('connector') ? 'connector' : false),
    });

    this.server.on('upgrade', (req, socket, head) => {
      const problems: string[] = [];
      if (req.headers.authorization !== `Connector ${this.sessionToken}`) problems.push('bad or missing Authorization on websocket');
      if (!String(req.headers['sec-websocket-protocol'] || '').split(/,\s*/).includes('connector')) {
        problems.push('websocket subprotocol "connector" not requested');
      }

      if (problems.length) {
        this.protocolErrors.push(...problems);
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => this.onSocket(ws));
    });

    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', () => resolve()));
    this.port = (this.server.address() as AddressInfo).port;
  }

  private async readJson(req: http.IncomingMessage) {
    let text = '';
    for await (const chunk of req) text += chunk;

    return text ? JSON.parse(text) : {};
  }

  private async onHttp(req: http.IncomingMessage, res: http.ServerResponse) {
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, {'Content-Type': 'application/json'});
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

    const body = await this.readJson(req);
    const auth = req.headers.authorization;

    if (req.method === 'POST' && req.url === '/connect') {
      const authorized = auth === `Connector ${this.sessionToken}`;
      this.connects.push({authorized, headers: req.headers});

      return authorized ? send(200, {}) : send(401);
    }

    if (req.method === 'POST' && req.url === '/register') {
      if (auth !== `Connector ${this.registrationToken}`) {
        this.protocolErrors.push('register called with a wrong registration token');
        return send(401);
      }

      const missing = ['name', 'version', 'id', 'publicKey', 'schema'].filter((key) => body[key] == null);
      if (missing.length) this.protocolErrors.push(`register body is missing: ${missing.join(', ')}`);

      this.id = body.id;
      this.version = body.version;
      if (req.headers['user-agent'] !== `${body.id}/${body.version}`) {
        this.protocolErrors.push(`register User-Agent should be id/version, got ${req.headers['user-agent']}`);
      }

      this.registrations.push(body);

      return send(200, {key: this.sessionToken});
    }

    if (req.method === 'POST' && req.url === '/disconnect') return send(200, {});

    this.protocolErrors.push(`unexpected request ${req.method} ${req.url}`);
    send(404);
  }

  private onSocket(ws: WebSocket) {
    this.socket = ws;

    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      const packets: Packet[] = frame.p;

      if (!Array.isArray(packets)) {
        this.protocolErrors.push('frame without a "p" array');
        return;
      }

      packets.forEach((packet) => this.onPacket(packet));
    });

    this.waiters.splice(0).forEach((fn) => fn());
  }

  private onPacket(packet: Packet) {
    this.received.push(packet);

    // an answer to something ALOMA sent
    if (packet.c && !packet.m && this.pending.has(packet.c)) {
      const done = this.pending.get(packet.c)!;
      this.pending.delete(packet.c);
      done(packet.a);
      return;
    }

    // the connector asks ALOMA for something (blob, task, ...) and expects an answer on its callback key
    if (packet.m && this.handlers.has(packet.m)) {
      Promise.resolve(this.handlers.get(packet.m)!(packet.a)).then(
        (answer) => packet.c && this.send({c: packet.c, a: answer}),
        (e) => packet.c && this.send({c: packet.c, a: {error: String(e)}})
      );
    }
  }

  /** answer connector -> ALOMA requests such as connector.blob.get or connector.task.new */
  handle(method: string, fn: (args: any) => any | Promise<any>) {
    this.handlers.set(method, fn);
    return this;
  }

  /** resolves when the connector's websocket is open (the handshake is finished) */
  async waitForConnection(timeoutMs = 5000) {
    if (this.connected) return;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `connector did not connect within ${timeoutMs}ms. registrations=${this.registrations.length} ` +
              `connects=${this.connects.length} protocolErrors=${JSON.stringify(this.protocolErrors)}`
          )
        );
      }, timeoutMs);

      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** resolves with the first packet the connector sent for `method` (e.g. connector.health.check), now or later */
  async waitForPacket(method: string, timeoutMs = 5000): Promise<Packet> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const found = this.received.find((packet) => packet.m === method);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`connector did not send ${method} within ${timeoutMs}ms`);

      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** send one raw packet to the connector */
  send(packet: Packet) {
    if (!this.connected) throw new Error('connector is not connected');

    this.socket!.send(JSON.stringify({p: [{id: randomUUID(), ...packet}]}));
  }

  /** send a packet with a callback key and wait for the connector's answer (its `a` field) */
  request(method: string, args: any, timeoutMs = 5000): Promise<any> {
    const key = `_req-${randomUUID()}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`no answer to ${method} within ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(key, (answer) => {
        clearTimeout(timer);
        resolve(answer);
      });

      this.send({m: method, c: key, a: args});
    });
  }

  /** ask the connector for its schema and method list (connector.introspect) */
  introspect() {
    return this.request('connector.introspect', {});
  }

  /**
   * Send the configuration the way ALOMA does: every field that is not `plain` is a JWE encrypted with the
   * public key the connector registered, audience = connector id. Resolves after the packet is sent;
   * the ConnectorHarness waits for the connector's start.
   */
  async setConfig(values: Record<string, any>) {
    if (!this.registration) throw new Error('connector has not registered yet');

    const fields = this.registration.schema?.configSchema?.fields || {};
    const publicKey = await jose.importSPKI(Buffer.from(this.registration.publicKey, 'base64').toString(), 'RSA-OAEP-256');
    const secrets: Record<string, any> = {};

    for (const [key, value] of Object.entries(values)) {
      if (fields[key]?.plain || key === 'endpointUrl') {
        secrets[key] = value;
        continue;
      }

      secrets[key] = await new jose.EncryptJWT({_data: value})
        .setProtectedHeader({alg: 'RSA-OAEP-256', enc: 'A256GCM'})
        .setIssuedAt()
        .setIssuer('home.aloma.io')
        .setAudience(this.id)
        .encrypt(publicKey);
    }

    this.send({m: 'connector.set-config', a: {secrets}});
  }

  /**
   * Call a connector method like ALOMA does (connector.query). Resolves with the connector's raw answer:
   * an object result is passed through, any other value is wrapped as {[method]: value}, a failure is {error}.
   */
  call(method: string | string[], variables?: any, ctx: {taskId?: string; namespace?: string; sticky?: boolean} = {}) {
    return this.request('connector.query', {query: method, variables, ...ctx});
  }

  async close() {
    this.pending.clear();
    this.wss.clients.forEach((client) => client.terminate());
    this.wss.close();
    this.server.closeAllConnections?.();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
