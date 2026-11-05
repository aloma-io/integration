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
