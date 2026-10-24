import net from 'node:net';

/**
 * Test-only network guard.
 *
 * While installed, any TCP connection to a host that is not loopback throws
 * immediately. fetch (undici), http, https, ws and axios all end up in
 * net.Socket.prototype.connect, so this is the safety net behind the vendor mock:
 * even code that bypasses global fetch cannot reach the network from a test.
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

let original: typeof net.Socket.prototype.connect | undefined;
let installs = 0;
export const blocked: string[] = [];

const targetOf = (args: any[]): {host: string; local: boolean} => {
  // net.connect hands over a normalized [options, callback] array
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];

  if (first && typeof first === 'object' && !Array.isArray(first)) {
    if (first.path) return {host: String(first.path), local: true};
    return {host: String(first.host ?? 'localhost'), local: false};
  }
  if (typeof first === 'number' || (typeof first === 'string' && !Number.isNaN(Number(first)))) {
    return {host: typeof args[1] === 'string' ? args[1] : 'localhost', local: false};
  }

  // unix socket path
  return {host: String(first), local: true};
};

export const installNetworkGuard = () => {
  if (installs++ > 0) return;

  original = net.Socket.prototype.connect;

  (net.Socket.prototype as any).connect = function (this: net.Socket, ...args: any[]) {
    const {host, local} = targetOf(args);

    if (!local && !LOOPBACK.has(host)) {
      const message = `NETWORK BLOCKED by connector test harness: connection to ${host} is not allowed in tests`;
      blocked.push(host);
      throw new Error(message);
    }

    return (original as any).apply(this, args);
  };
};

export const uninstallNetworkGuard = () => {
  if (installs === 0) return;
  if (--installs > 0) return;

  (net.Socket.prototype as any).connect = original;
  original = undefined;
};
