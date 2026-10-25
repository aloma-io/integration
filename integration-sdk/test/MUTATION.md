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
