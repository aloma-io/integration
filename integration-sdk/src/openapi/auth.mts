/**
 * How a generated connector authenticates. Generated code only makes requests; this hand-written part
 * says where the credential comes from: OAuth through the SDK runtime, an access token from the
 * connector's configuration, or either (the token wins when it is set).
 */
export interface AuthPlan {
  /**
   * OAuth 2.0 authorization code flow, run by the SDK runtime (connect, token refresh, storage).
   * The client id and secret come from OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET where the connector runs.
   */
  oauth?: {
    /** with {{clientId}}, {{redirectURI}} and {{scope}} placeholders */
    authorizationURL: string;
    tokenURL: string;
    scope?: string;
    additionalTokenArgs?: {[key: string]: any};
    useAuthHeader?: boolean;
    useCodeChallenge?: boolean;
    connectionOptional?: boolean;
  };
  /**
   * an access token or API key set in the connector's configuration
   */
  token?: {
    field: string;
    name: string;
    description?: string;
    placeholder?: string;
    /** request header, default Authorization */
    header?: string;
    /** text before the token, default "Bearer " */
    prefix?: string;
  };
}

/**
 * Declares the plan to the connector builder: OAuth (optional when a token can be used instead) and the
 * token's configuration field, plus any other configuration.
 */
export function configureAuth(
  builder: {auth(arg: any): any; config(arg: any): any},
  plan: AuthPlan,
  config: {summary?: string; description?: string; fields?: {[key: string]: any}} = {}
) {
  if (plan.oauth) {
    builder.auth({oauth: {...plan.oauth, connectionOptional: plan.token ? true : plan.oauth.connectionOptional}});
  }

  const fields = {...(config.fields || {})};
  if (plan.token) {
    fields[plan.token.field] = {
      name: plan.token.name,
      type: 'line',
      ...(plan.token.placeholder ? {placeholder: plan.token.placeholder} : {}),
      ...(plan.token.description ? {description: plan.token.description} : {}),
      ...(plan.oauth ? {optional: true} : {}),
    };
  }

  if (config.summary || config.description || Object.keys(fields).length) {
    builder.config({
      ...(config.summary ? {summary: config.summary} : {}),
      ...(config.description ? {description: config.description} : {}),
      ...(Object.keys(fields).length ? {fields} : {}),
    });
  }

  return builder;
}

/**
 * Options for getClient() that put the right credential on every request.
 *
 * With OAuth in the plan, getClient() returns the runtime's OAuth client; a configured token then
 * replaces the OAuth token. Without OAuth, the token is set as a header, and a request without one is
 * refused before it is sent.
 */
export function clientAuth(plan: AuthPlan, config: {[key: string]: any} = {}) {
  const token = plan.token ? config?.[plan.token.field] : undefined;

  if (plan.oauth) {
    return token ? {getToken: async () => String(token)} : {};
  }

  if (plan.token) {
    const {name, header = 'Authorization', prefix = 'Bearer '} = plan.token;
    return {
      customize(request: any) {
        if (!token) throw new Error(`${name} is not configured for this connector`);
        request.headers ||= {};
        request.headers[header] = `${prefix}${token}`;
      },
    };
  }

  return {};
}

/**
 * HubSpot: OAuth through ALOMA's HubSpot app, with the scopes the existing hubspot.com connector uses,
 * or a private app access token.
 */
export const hubspotAuth: AuthPlan = {
  oauth: {
    authorizationURL:
      'https://app.hubspot.com/oauth/authorize?client_id={{clientId}}&redirect_uri={{redirectURI}}&scope={{scope}}',
    tokenURL: 'https://api.hubapi.com/oauth/v1/token',
    scope:
      'oauth crm.lists.read crm.objects.contacts.read crm.objects.contacts.write crm.schemas.contacts.read crm.lists.write crm.schemas.contacts.write',
    additionalTokenArgs: {grant_type: 'authorization_code'},
  },
  token: {
    field: 'apiToken',
    name: 'Private app access token',
    description: 'A HubSpot private app access token. Leave empty to connect with OAuth instead.',
    placeholder: 'pat-...',
  },
};
