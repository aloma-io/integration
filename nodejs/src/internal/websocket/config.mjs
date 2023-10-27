import C from "./connection/constants.mjs";
import JWE from "../util/jwe/index.mjs";

class Config {
  constructor({
    registrationToken,
    version,
    name,
    id,
    endpoint,
    wsEndpoint,
    privateKey,
    publicKey,
    introspect,
    configSchema,
    icon,
  }) {
    this._token = null;
    this._registrationToken = registrationToken;
    this._version = version;
    this._name = name;
    this._endpoint = endpoint;
    this._wsEndpoint = wsEndpoint;
    this._id = id;
    this._data = {};
    this._privateKey = privateKey;
    this._publicKey = publicKey;
    this._jwe = new JWE({});
    this._introspect = introspect;
    this._configSchema = configSchema;
    this._icon = icon;

    if (!registrationToken)
      throw new Error("empty registration token (set env.REGISTRATION_TOKEN)");
    if (!endpoint) throw new Error("empty endpoint (set env.DEVICE_ENDPOINT)");
    if (!wsEndpoint)
      throw new Error("empty registration token (set env.WEBSOCKET_ENDPOINT)");

    if (!this._id || !this._version)
      throw new Error("need connector id and version");
  }

  async validateKeys(algorithm) {
    if (!this._privateKey || !this._publicKey)
      throw new Error("need private and public key");

    await this._jwe.importBase64Pair({
      publicKey: this._publicKey,
      privateKey: this._privateKey,
      algorithm,
    });

    return this._jwe;
  }

  data(what) {
    if (what) {
      this._data = what;
    }

    return this._data;
  }

  introspect() {
    return this._introspect();
  }

  configSchema() {
    return this._configSchema();
  }

  publicKey() {
    return this._publicKey;
  }

  id() {
    return this._id;
  }

  version() {
    return this._version;
  }

  name() {
    return this._name;
  }

  url() {
    return this._endpoint;
  }

  wsUrl() {
    return this._wsEndpoint;
  }

  registrationToken() {
    return this._registrationToken;
  }

  token() {
    return this._token;
  }

  icon() {
    return this._icon;
  }

  setToken(what) {
    this._token = what;
  }
}

export { Config };
