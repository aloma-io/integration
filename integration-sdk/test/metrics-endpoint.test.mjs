// The metrics endpoint (internal/connector/metrics): GET /metrics on port 4050, answered on loopback with the
// Prometheus text format and the connector's default labels. Standalone script (no mocha). The server is never closed
// by the SDK, so this script ends with process.exit.
import http from 'node:http';
import {makeMetrics} from '../build/internal/connector/metrics.mjs';
import {assert, assertEqual, suite} from './helpers/flow-kit.mjs';

const {test, finish} = suite('metrics endpoint');

const get = (path) =>
  new Promise((resolve, reject) => {
    http
      .get({host: '127.0.0.1', port: 4050, path}, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body}));
      })
      .on('error', reject);
  });

await makeMetrics({id: 'metrics-test-id', name: 'metrics-test-name', version: '9.8.7'});
await new Promise((resolve) => setTimeout(resolve, 50));

await test('GET /metrics on 127.0.0.1:4050 answers 200 with the Prometheus text content type', async () => {
  const res = await get('/metrics');
  assertEqual(res.status, 200, 'status');
  assert(/^text\/plain; (charset=utf-8; )?version=0\.0\.4/.test(res.headers['content-type']), `content type was ${res.headers['content-type']}`);
});

await test('the metrics body carries the service, connector id and connector version as labels', async () => {
  const res = await get('/metrics');
  assert(res.body.includes('service="metrics-test-name"'), 'service label');
  assert(res.body.includes('connectorId="metrics-test-id"'), 'connectorId label');
  assert(res.body.includes('connectorVersion="9.8.7"'), 'connectorVersion label');
});

await test('the metrics body holds the default process metrics', async () => {
  const res = await get('/metrics');
  assert(/^process_cpu_user_seconds_total\{/m.test(res.body), 'process_cpu_user_seconds_total present');
});

await test('GET on any other path answers 404', async () => {
  const res = await get('/other');
  assertEqual(res.status, 404, 'status');
});

finish();
