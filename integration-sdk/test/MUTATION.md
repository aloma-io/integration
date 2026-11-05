# Mutation check for the connector test harness

Result: **32/32 mutants killed**.

Each row is one deliberate single-point bug in the SDK code paths the harness exercises (handshake, transport,
dispatch, result return, config) or in the harness itself. `tools/mutation-run.mjs` applies it to `src/`, rebuilds,
runs `test/harness.test.mjs` with `--bail`, expects a failure, and restores the file. Re-run with
`yarn build && yarn test:mutation` after changing the harness or those SDK paths.

| # | Area | File | Bug | Result |
|---|------|------|-----|--------|
| M01 | sdk handshake | `src/internal/websocket/connection/index.mjs` | a 401 from /connect no longer triggers registration | killed |
| M02 | sdk handshake | `src/internal/websocket/connection/index.mjs` | the token from registration is not stored | killed |
| M03 | sdk handshake | `src/internal/websocket/connection/registration.mjs` | registration reads the wrong field of the answer | killed |
| M04 | sdk handshake | `src/internal/websocket/connection/registration.mjs` | registration sends the name as the connector id | killed |
| M05 | sdk handshake | `src/internal/websocket/connection/registration.mjs` | registration omits the public key | killed |
| M06 | sdk handshake | `src/internal/websocket/connection/constants.mjs` | authenticated requests drop the version from the User-Agent | killed |
| M07 | sdk handshake | `src/internal/websocket/connection/constants.mjs` | wrong authorization scheme for the session token | killed |
| M08 | sdk handshake | `src/internal/websocket/transport/index.mjs` | websocket opened without the "connector" subprotocol | killed |
| M09 | sdk transport | `src/internal/websocket/transport/index.mjs` | the first packet of every incoming frame is dropped | killed |
| M10 | sdk transport | `src/internal/websocket/transport/index.mjs` | outgoing frames use the wrong envelope | killed |
| M11 | sdk transport | `src/internal/websocket/transport/index.mjs` | answers to connector-initiated requests are never routed to their callback | killed |
| M12 | sdk dispatch | `src/internal/dispatcher/index.mts` | configuration secrets are dropped before onConfig | killed |
| M13 | sdk dispatch | `src/internal/dispatcher/index.mts` | sticky is not forwarded to the method | killed |
| M14 | sdk dispatch | `src/internal/dispatcher/index.mts` | unknown methods are no longer reported as "not found" | killed |
| M15 | sdk result return | `src/internal/dispatcher/index.mts` | scalar results are wrapped under the wrong key | killed |
| M16 | sdk result return | `src/internal/util/index.mts` | successful results are replied empty | killed |
| M17 | sdk result return | `src/internal/util/index.mts` | errors lose their message | killed |
| M18 | sdk result return | `src/internal/connector/server/on-message.mts` | results are never sent back | killed |
| M19 | sdk config | `src/internal/connector/server/on-connect/decrypt-config.mts` | config is decrypted for the wrong audience | killed |
| M20 | sdk config | `src/internal/connector/server/on-connect/decrypt-config.mts` | plain fields are decrypted like secrets | killed |
| M21 | sdk config | `src/internal/connector/server/on-connect/index.mts` | main() receives an empty config | killed |
| M22 | harness vendor mock | `src/testing/vendor-mock.mts` | an unmocked request is answered instead of rejected | killed |
| M23 | harness vendor mock | `src/testing/vendor-mock.mts` | verify() never fails | killed |
| M24 | harness vendor mock | `src/testing/vendor-mock.mts` | mocked status codes are ignored | killed |
| M25 | harness vendor mock | `src/testing/vendor-mock.mts` | the times limit on a route is ignored | killed |
| M26 | harness network guard | `src/testing/network-guard.mts` | the network guard lets everything through (the mutant may try one TCP connect to the TEST-NET-3 documentation address 203.0.113.9) | killed |
| M27 | harness fake ALOMA | `src/testing/fake-aloma.mts` | the fake accepts a connect without registration | killed |
| M28 | harness fake ALOMA | `src/testing/fake-aloma.mts` | the fake encrypts config for the wrong audience | killed |
| M29 | harness fake ALOMA | `src/testing/fake-aloma.mts` | the fake drops the connector's answer | killed |
| M30 | harness fake ALOMA | `src/testing/fake-aloma.mts` | call() drops the ctx fields | killed |
| M31 | harness | `src/testing/harness.mts` | stop() no longer fails on unmocked requests | killed |
| M32 | harness | `src/testing/harness.mts` | the harness never sends configuration | killed |

## PLAT-23: OAuth start and finish flows, websocket transport

Result: **25/25 patches killed** (each applied alone, rebuilt, run against its test file; the named test fails, source restored).
The patches are `test/mutants/*.patch` (first line names the test that must fail). Run one by hand with `git apply test/mutants/<file>.patch` from the repository root, `yarn build`, `node test/<file>`, then `git apply -R`.
A01 and A08 add a check that does not exist today (state, replay guard), T04 adds a catch that does not exist today, T11 fixes a bug: they are caught by the `PINS SUSPECT BEHAVIOUR` tests, which must be revisited when the real fix lands. T05 is the "handler error swallowed" mutant for the live path (on-message.mts); the Processor class swallows by itself and is pinned (T06 removes its log line).

| # | File | Bug | Killed by | Result |
|---|------|-----|-----------|--------|
| A01 | `src/internal/connector/server/on-connect/finish-oauth.mts` | a state check is added to finishOAuth (none exists today; the pin must fail) | `oauth-start-finish.test.mjs`: finish: PINS SUSPECT BEHAVIOUR: there is no state check, the exchange runs for whatever is passed and "state" is neither required nor sent | killed |
| A02 | `src/internal/connector/server/on-connect/finish-oauth.mts` | the PKCE code_verifier is not sent | `oauth-start-finish.test.mjs`: finish: with useCodeChallenge the PKCE code verifier is sent | killed |
| A03 | `src/internal/connector/server/on-connect/finish-oauth.mts` | the token request auth form is flipped (header when not asked, body when asked) | `oauth-start-finish.test.mjs`: finish: the code is exchanged once, with a form POST holding grant type, code, redirect URI, client id and secret | killed |
| A04 | `src/internal/connector/server/on-connect/finish-oauth.mts` | the code_verifier is sent although the connector did not ask for PKCE | `oauth-start-finish.test.mjs`: finish: without useCodeChallenge no code verifier is sent, even if the platform passes one | killed |
| A05 | `src/internal/connector/server/on-connect/finish-oauth.mts` | redirect_uri is not sent to the token endpoint | `oauth-start-finish.test.mjs`: finish: the code is exchanged once, with a form POST holding grant type, code, redirect URI, client id and secret | killed |
| A06 | `src/internal/connector/server/on-connect/finish-oauth.mts` | a 4xx from the token endpoint is read as an answer | `oauth-start-finish.test.mjs`: finish: an error status from the token endpoint throws "<status> <body>", after one request and no retry | killed |
| A07 | `src/internal/connector/server/on-connect/finish-oauth.mts` | the token endpoint answer (tokens) is written to the log | `oauth-start-finish.test.mjs`: finish: neither the code, the secret nor the tokens are logged, on success or on failure | killed |
| A08 | `src/internal/connector/server/on-connect/finish-oauth.mts` | a used code is refused on a second exchange (no guard exists today; the pin must fail) | `oauth-start-finish.test.mjs`: finish: PINS SUSPECT BEHAVIOUR: the same code can be exchanged again, the SDK keeps no record of used codes | killed |
| A09 | `src/internal/connector/server/on-connect/start-oauth.mts` | the scope is put in the authorize URL without URL-encoding | `oauth-start-finish.test.mjs`: start: the authorize URL carries the client id and the scopes, URL-encoded, and says whether PKCE is used | killed |
| A10 | `src/internal/connector/server/on-connect/start-oauth.mts` | the client id from the environment beats the one the platform sent | `oauth-start-finish.test.mjs`: start: client id comes from the config, then the environment, then the connector; the authorize URL and scope prefer the environment | killed |
| A11 | `src/internal/connector/server/on-connect/finish-oauth.mts` | finish returns the plain access token instead of the sealed result | `oauth-start-finish.test.mjs`: finish: returns the token answer sealed for this connector in {value}; the plain token is not in the return value | killed |
| T01 | `src/internal/websocket/transport/durable.mjs` | a message that cannot be sent is not kept for the reconnect | `websocket-durable.test.mjs`: queue: messages sent before the socket is open are held and delivered in order, once, when it opens | killed |
| T02 | `src/internal/websocket/transport/durable.mjs` | the held messages are sent but never removed, so every reconnect sends them again | `websocket-durable.test.mjs`: queue: after a disconnect and a reconnect nothing already delivered is sent again | killed |
| T03 | `src/internal/websocket/transport/durable.mjs` | held messages are sent newest first | `websocket-durable.test.mjs`: queue: messages sent before the socket is open are held and delivered in order, once, when it opens | killed |
| T04 | `src/internal/websocket/transport/index.mjs` | a try/catch is added around the frame parse (nothing catches a malformed frame today; the pin must fail) | `websocket-transport.test.mjs`: receive: PINS SUSPECT BEHAVIOUR: a frame that is not JSON throws out of a timer callback (uncaught); the next good frame still works | killed |
| T05 | `src/internal/connector/server/on-message.mts` | a handler error gets no error reply and is not logged as a packet error | `websocket-transport.test.mjs`: handler: a message type nobody handles (the dispatcher throws) is answered with an error and the connector keeps going | killed |
| T06 | `src/internal/websocket/transport/processor.mjs` | the processor drops a handler error without logging it | `websocket-transport.test.mjs`: processor: a handler that throws is logged with the packet, the other packets of the frame are still processed | killed |
| T07 | `src/internal/websocket/transport/index.mjs` | packets of a frame go out newest first | `websocket-transport.test.mjs`: send: packets of one tick go out in one frame {p:[...]} in the order they were sent; nothing is sent twice | killed |
| T08 | `src/internal/websocket/transport/index.mjs` | packets are taken off the queue although the socket is not connected | `websocket-transport.test.mjs`: send: while the socket is not connected the packets stay queued, in order, and none is lost | killed |
| T09 | `src/internal/websocket/transport/index.mjs` | a callback is not removed after it was answered | `websocket-transport.test.mjs`: receive: an answer to a connector request goes to its callback with the packet args, once, and the callback is then forgotten | killed |
| T10 | `src/internal/websocket/transport/index.mjs` | clean() times out the young callbacks instead of the old ones | `websocket-transport.test.mjs`: clean: callbacks older than 5 minutes get {error:"timeout"} and are removed, younger ones stay | killed |
| T11 | `src/internal/websocket/transport/index.mjs` | close() terminates the socket (the undefined `local` is fixed; the pin must fail) | `websocket-transport.test.mjs`: close: PINS SUSPECT BEHAVIOUR: close() never terminates the socket (it uses an undefined variable inside a try) | killed |
| T12 | `src/internal/websocket/transport/durable.mjs` | the durable socket does not reconnect after a close | `websocket-durable.test.mjs`: reconnect: a close from the server schedules a new connection after 5 s; it opens, onConnect runs again and the failure count resets | killed |
| T13 | `src/internal/websocket/transport/processor.mjs` | the processor answers a wrapped packet under the inner callback key | `websocket-transport.test.mjs`: processor: a packet that wraps another in args.packet is processed as the inner packet and answered under the outer callback key | killed |
| T14 | `src/internal/websocket/transport/packet.mjs` | a packet without an id does not get one | `websocket-transport.test.mjs`: packet: gets a 32 character id, keeps a given one, and reads and writes method, callback, event and args | killed |

## PLAT-23: runtime paths (fetcher, OAuth fetcher, JWE config)

Result: **25/25 patches killed** here, 50/50 together with the section above (each applied alone, rebuilt, run against `test/fetcher-retry.test.mjs`, `test/oauth-fetcher.test.mjs` and `test/jwe-config.test.mjs`; the named test fails, source restored).
The patches are `test/mutants/*.patch` (first line names the test that must fail); the gate applies them itself. Run one by hand with `git apply test/mutants/<file>.patch` from the repository root, `yarn build`, `yarn test`, then `git apply -R`.
Not buildable as a mutant: "Retry-After ignored" (the code never reads it, so R03 shortens the 429 wait and a pin records the fixed 10 s), "POST retried" (already retried: R05 stops it and the pin fails), "no single flight" (O03 adds one and the pin fails), "JWE tag check skipped / wrong key accepted" (inside `jose`, not in this repository: J01 swallows decrypt errors, which makes both observable).

The fake back-off timers in `test/helpers/mini.mjs` record only timers set from `build/internal/fetcher/` (Node 18 timer capture, checked by `test/fake-timers-scope.test.mjs`, which has no mutant of its own).

| # | File | Bug | Killed by | Result |
|---|------|-----|-----------|--------|
| R01 | `src/internal/fetcher/fetcher.mts` | one attempt too many before the error is thrown | `fetcher-retry.test.mjs`: a 5xx is retried; `retry` is the total number of attempts, 500 ms apart | killed |
| R02 | `src/internal/fetcher/fetcher.mts` | retry cap removed: a failing vendor is retried without end | `fetcher-retry.test.mjs`: a 5xx is retried; `retry` is the total number of attempts, 500 ms apart | killed |
| R03 | `src/internal/fetcher/fetcher.mts` | a 429 waits only 500 ms (the 429 wait is shortened) | `fetcher-retry.test.mjs`: a 429 is retried after 10 s, and the retry succeeds | killed |
| R04 | `src/internal/fetcher/fetcher.mts` | 429 handled like any error: counted against retry, 500 ms wait | `fetcher-retry.test.mjs`: a 429 is retried after 10 s, and the retry succeeds | killed |
| R05 | `src/internal/fetcher/fetcher.mts` | a POST is no longer retried | `fetcher-retry.test.mjs`: PINS SUSPECT BEHAVIOUR: a POST is retried after a 5xx with the same body (duplicate writes) | killed |
| R06 | `src/internal/fetcher/fetcher.mts` | a step can set a timeout above the 30 minute cap | `fetcher-retry.test.mjs`: the timeout defaults to 30 minutes and is capped at 30 minutes | killed |
| R07 | `src/internal/fetcher/fetcher.mts` | the failure log line includes the query string | `fetcher-retry.test.mjs`: a failed attempt is logged with the url without its query string | killed |
| R08 | `src/internal/fetcher/fetcher.mts` | the thrown error carries no status | `fetcher-retry.test.mjs`: an error status throws "<status> <body>" with .status, and onResponse is not called | killed |
| O01 | `src/internal/fetcher/oauth-fetcher.mts` | a 401 no longer triggers a token refresh | `oauth-fetcher.test.mjs`: a 401 makes the next attempt refresh the token (after 500 ms) and retry with the new one | killed |
| O02 | `src/internal/fetcher/oauth-fetcher.mts` | the refreshed token is not stored | `oauth-fetcher.test.mjs`: the refreshed token is stored (in memory and saved) and later calls reuse it without another refresh | killed |
| O03 | `src/internal/fetcher/oauth-fetcher.mts` | concurrent calls share one refresh (the missing single flight is "fixed") | `oauth-fetcher.test.mjs`: PINS SUSPECT BEHAVIOUR: concurrent calls each refresh (no single flight); the refreshed token is used by all | killed |
| O04 | `src/internal/fetcher/oauth-fetcher.mts` | a failed refresh leaves the dead access token in place | `oauth-fetcher.test.mjs`: a refresh answer without access_token fails the call, wipes the stored access token and stores nothing | killed |
| O05 | `src/internal/fetcher/oauth-fetcher.mts` | a refresh answer without refresh_token erases the stored one | `oauth-fetcher.test.mjs`: an answer without a new refresh_token keeps the old one | killed |
| O06 | `src/internal/fetcher/oauth-fetcher.mts` | wrong authorization scheme | `oauth-fetcher.test.mjs`: an existing access token is sent as Bearer and nothing is refreshed | killed |
| O07 | `src/internal/fetcher/oauth-fetcher.mts` | the new access token is written to the log | `oauth-fetcher.test.mjs`: no token appears in the log lines of a failed call and refresh | killed |
| O08 | `src/internal/fetcher/oauth-fetcher.mts` | every client is refreshed (the clients[0] defect "fixed") | `oauth-fetcher.test.mjs`: PINS SUSPECT BEHAVIOUR: OAuth.periodicRefresh refreshes only the first client, once per client slot | killed |
| K01 | `src/internal/connector/server/on-connect/make-oauth.mts` | a 4xx from the token endpoint is taken as a token | `oauth-fetcher.test.mjs`: a token endpoint answering 200 gives the parsed JSON; any other status throws "could not get refresh token <status> <body>" | killed |
| K02 | `src/internal/connector/server/on-connect/make-oauth.mts` | the stored OAuth result expires after 7 days | `oauth-fetcher.test.mjs`: the saved OAuth result goes out as a connector.config-update packet holding a JWE for this connector, without expiry | killed |
| J01 | `src/internal/util/jwe/index.mts` | decrypt errors (wrong key, bad authentication tag) are swallowed | `jwe-config.test.mjs`: a wrong key cannot decrypt | killed |
| J02 | `src/internal/util/jwe/index.mts` | the audience is not checked | `jwe-config.test.mjs`: a token for another audience or from another issuer is refused | killed |
| J03 | `src/internal/util/jwe/index.mts` | the issuer is not checked | `jwe-config.test.mjs`: a token for another audience or from another issuer is refused | killed |
| J04 | `src/internal/util/jwe/index.mts` | the token expiry is not enforced | `jwe-config.test.mjs`: an expired token is refused with a JWTExpired error | killed |
| J05 | `src/internal/util/jwe/index.mts` | an algorithm allow-list is added (the pin must be revisited) | `jwe-config.test.mjs`: PINS SUSPECT BEHAVIOUR: there is no allow-list of algorithms; another content encryption (A128GCM) is accepted | killed |
| J06 | `src/internal/connector/server/on-connect/decrypt-config.mts` | a value that fails to decrypt is passed on as config | `jwe-config.test.mjs`: decryptConfig drops a value that fails to decrypt (wrong key, tampered, expired, wrong audience) and keeps the rest | killed |
| J07 | `src/internal/connector/server/on-connect/decrypt-config.mts` | the failure log keeps the token that the error quoted | `jwe-config.test.mjs`: the token is masked as *** where a library error message would have quoted it | killed |
