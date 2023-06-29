import {Builder} from '@aloma.io/integration-sdk';

const builder = new Builder();
const runtime = await builder.build();

await runtime.start();
