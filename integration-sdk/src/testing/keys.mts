import JWE from '../internal/util/jwe/index.mjs';

let pair: Promise<{privateKey: string; publicKey: string}> | undefined;

/**
 * One throwaway RSA key pair per process, generated at test time.
 * Never committed, never a real key. Same encoding the connector expects in
 * env.PRIVATE_KEY / env.PUBLIC_KEY (base64 of the PEM).
 */
export const testKeyPair = () => {
  pair ||= (async () => {
    const jwe = new JWE({algorithm: 'RSA-OAEP-256'});
    await jwe.newPair();

    return {privateKey: await jwe.exportPrivateAsBase64(), publicKey: await jwe.exportPublicAsBase64()};
  })();

  return pair;
};
