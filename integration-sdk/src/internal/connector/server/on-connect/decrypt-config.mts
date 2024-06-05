
export const decryptConfig = async ({configSchema, config, secrets}) => {
  const decrypted: any = {};

  const fields = configSchema().fields;

  const keys = Object.keys(secrets);
  const jwe = await config.validateKeys("RSA-OAEP-256");

  for (var i = 0; i < keys.length; ++i) {
    const key = keys[i];
    const value = secrets[key];
    if (!value) continue;

    if (fields[key]?.plain || ["endpointUrl"].includes(key)) {
      decrypted[key] = value;
    } else {
      try {
        decrypted[key] = await jwe.decrypt(value, config.id());
      } catch (e) {
        console.log("failed to decrypt key", key, config.id(), e);
      }
    }
  }

  return decrypted;
}