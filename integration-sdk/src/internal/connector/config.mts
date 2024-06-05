import JWE from "../util/jwe/index.mjs";
import { Config } from "../websocket/config.mjs";

export const makeConfig = async ({id, version, name, introspect, configSchema, icon}): Promise<Config> => {
  const config = new Config({
    id: id,
    version: version,
    name: process.env.HOSTNAME || name,
    registrationToken: process.env.REGISTRATION_TOKEN,
    endpoint: process.env.DEVICE_ENDPOINT || "https://connect.aloma.io/",
    wsEndpoint:
      process.env.WEBSOCKET_ENDPOINT || "wss://connect.aloma.io/transport/",
    privateKey: process.env.PRIVATE_KEY,
    publicKey: process.env.PUBLIC_KEY,
    introspect,
    configSchema,
    icon: icon,
  });

  if (Object.keys(configSchema().fields).length) {
    try {
      await config.validateKeys();
    } catch (e) {
      const haveKey = !!process.env.PRIVATE_KEY;
      const jwe = new JWE({});
      var text = "Please double check the env variables";

      if (!haveKey) {
        await jwe.newPair();
        text =
          "fresh keys generated, set environment variables: \n\nPRIVATE_KEY: " +
          (await jwe.exportPrivateAsBase64()) +
          "\n\nPUBLIC_KEY: " +
          (await jwe.exportPublicAsBase64()) +
          "\n";
      }

      console.log(`
Error:

public (env.PUBLIC_KEY) and private key (env.PRIVATE_KEY) could not be loaded.

${text}
      `);

      await new Promise((resolve) => {
        setTimeout(() => {
          resolve(null);
        }, 2 * 60 * 1000);
      });

      throw new Error('could not start');
    }
  }

  return config;
}