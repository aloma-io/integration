// PLAT-23: the fake back-off timers (helpers/mini.mjs) record only timers set by the SDK's fetchers. On Node 18 the
// built-in fetch sets its own 10 s connect timer through the global setTimeout; it must not show up as a back-off.
// The stand-in here sets 10 s and 500 ms timers from the test and the vendor mock (code outside the SDK) during a call.
import Fetcher from '../build/internal/fetcher/fetcher.mjs';
import {assertEqual, fakeTimers, json, outcome, suite, vendor} from './helpers/mini.mjs';

const {test, finish} = suite('Fake timers scope');

const strayTimers = () => {
  const handles = [setTimeout(() => {}, 10000), setTimeout(() => {}, 500)];
  handles.forEach((h) => clearTimeout(h));
};

await test('timers set outside the SDK during a call are not back-offs', async () => {
  const v = await vendor((req, res) => {
    strayTimers();
    json(res, 200, {ok: true});
  });
  const timers = fakeTimers();
  try {
    strayTimers();
    const result = await outcome(new Fetcher({baseUrl: v.baseUrl}).fetch('/x', {method: 'GET'}));
    assertEqual(result.value, {ok: true}, 'call succeeded');
    assertEqual(timers.delays, [], 'no back-off recorded');
  } finally {
    timers.restore();
    await v.close();
  }
});

await test('the SDK back-off is still recorded next to outside timers', async () => {
  const v = await vendor((req, res) => {
    strayTimers();
    if (req.url === '/r' && v.requests.length === 1) return res.writeHead(503).end('down');
    json(res, 200, {ok: true});
  });
  const timers = fakeTimers();
  try {
    const result = await outcome(new Fetcher({baseUrl: v.baseUrl, retry: 2}).fetch('/r', {method: 'GET'}));
    assertEqual(result.value, {ok: true}, 'second attempt succeeded');
    assertEqual(timers.delays, [500], 'only the fetcher back-off');
  } finally {
    timers.restore();
    await v.close();
  }
});

finish();
