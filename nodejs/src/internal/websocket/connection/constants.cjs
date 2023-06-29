const AUTHORIZATION = "Authorization";

module.exports = {
  augmentRequest: (what, config) => {
    what.headers = {
      ...what.headers,
      "User-Agent": config.id() + "/" + config.version(),
    };

    what.headers[AUTHORIZATION] = `Connector ${config.token()}`;

    return what;
  },

  augmentRegistration: (what, config) => {
    what.headers = {
      ...what.headers,
      "User-Agent": config.id() + "/" + config.version(),
    };

    what.headers[AUTHORIZATION] = `Connector ${config.registrationToken()}`;

    return what;
  },
};
