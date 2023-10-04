class Dispatcher {
  constructor() {
    this._config = { fields: {} };
  }

  main(what) {
    this._main = what;

    return this;
  }

  oauth(arg) {
    if (arg.platformOAuth) {
      this.config({
        oauth: true,
        fields: {
          oauthResult: {
            name: "OAuth Result",
            placeholder: "will be set by finishing the oauth flow",
            type: "managed",
          },
        },
      });

      return this;
    }

    if (!arg.authorizationURL) throw new Error("need a authorizationURL");
    if (!arg.tokenURL && !arg.finishOAuth)
      throw new Error("need a tokenURL or finishOAuth()");

    this._oauth = { ...arg };

    this.config({
      oauth: true,
      fields: {
        oauthResult: {
          name: "OAuth Result",
          placeholder: "will be set by finishing the oauth flow",
          type: "managed",
          optional: !!arg.connectionOptional,
        },
      },
    });

    if (arg.configurableClient) {
      this.config({
        fields: {
          clientId: {
            name: "OAuth Client ID",
            placeholder: "e.g. 1234",
            type: "line",
            optional: !!arg.configurableClientOptional,
            plain: true
          },
          clientSecret: {
            name: "OAuth Client Secret",
            placeholder: "e.g. axd5xde",
            optional: !!arg.configurableClientOptional,
            type: "line",
          },
        },
      });
    }
    
    if (arg.configurableClientScope) {
      this.config({
        fields: {
          scope: {
            name: "OAuth Scope",
            placeholder: "e.g. x y z",
            type: "line",
            description: `Default Scope:
            
${arg.configurableClientScope}
`,
            optional: true,
            plain: true
          }
        },
      });
    }

    return this;
  }

  types(what) {
    this._types = what;

    return this;
  }

  config({ fields, oauth, description, summary }) {
    this._config.oauth = this._config.oauth || oauth;
    this._config.description = this._config.description || description;
    this._config.summary = this._config.summary || summary;
    this._config.fields = { ...fields, ...this._config.fields };

    return this;
  }

  resolvers(what) {
    this._resolvers = { ...this._resolvers, ...what };

    return this;
  }

  endpoint(what, notOptional) {
    this.config({
      fields: {
        _endpointToken: {
          name: "Endpoint Token",
          placeholder: "e.g. 1234",
          type: !!notOptional?"managed":"line",
          plain: true,
          optional: !notOptional,
        },
      },
    });

    this.resolvers({ _endpoint: what });

    return this;
  }

  startOAuth() {
    throw new Error("oauth not configured");
  }

  finishOAuth() {
    throw new Error("oauth not configured");
  }

  build() {
    if (!this._types || !this._resolvers)
      throw new Error("missing types or resolvers");
    var local = this;

    const _resolvers = { ...this._resolvers };

    const main = this._main || (() => {});

    const start = async (transport) => {
      console.log("starting ...");
      await main(transport);
    };

    const resolveMethod = (query) => {
      let current = _resolvers;

      while (query.length && current) {
        current = current[query.shift()];
      }

      return current;
    };

    const execute = async ({ query, variables }) => {
      if (!Array.isArray(query)) query = [query];

      query = query
        .filter(
          (what) =>
            !!what?.trim() &&
            ![
              "constructor",
              "__proto__",
              "toString",
              "toSource",
              "prototype",
            ].includes(what),
        )
        .slice(0, 20);

      const method = resolveMethod(query);
      if (!method && !_resolvers.__default)
        throw new Error(`${query} not found`);

      return method
        ? method(variables)
        : _resolvers.__default(
            variables ? { ...variables, __method: query } : variables,
          );
    };

    const introspect = () => local._types;
    const configSchema = () => local._config;

    const processPacket = async (packet) => {
      switch (packet.method()) {
        case "connector.introspect":
          const intro = await introspect({});

          return { configSchema: local._config, introspect: intro };

        case "connector.start-oauth":
          return await local.startOAuth(packet.args());

        case "connector.finish-oauth":
          return await local.finishOAuth(packet.args());

        case "connector.query":
          const ret = await execute(packet.args());

          return typeof ret === "object" && !Array.isArray(ret)
            ? ret
            : { [packet.args().query]: ret };

        case "connector.set-config":
          await local.onConfig({ ...packet.args().secrets });

          return;
      }

      console.dir(packet, { depth: null });
      throw new Error("cannot handle packet");
    };

    return {
      introspect,
      configSchema,
      execute,
      processPacket,
      start,
    };
  }
}

export { Dispatcher };
