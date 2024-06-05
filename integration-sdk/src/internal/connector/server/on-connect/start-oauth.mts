
export const patchStartOAuth = async ({dispatcher, decrypted}) => {
  dispatcher.startOAuth = async function () {
    if (!dispatcher._oauth) throw new Error("oauth not configured");

    const authorizationURL =
      process.env.OAUTH_AUTHORIZATION_URL ||
      decrypted.authorizationURL ||
      dispatcher._oauth.authorizationURL;

    if (!authorizationURL)
      throw new Error("authorizationURL not configured");

    const clientId =
      decrypted.clientId ||
      process.env.OAUTH_CLIENT_ID ||
      dispatcher._oauth.clientId;

    if (!clientId) throw new Error("clientId not configured");

    const scopes =
      process.env.OAUTH_SCOPE ||
      decrypted.scope ||
      dispatcher._oauth.scope ||
      "";
    const useCodeChallenge = !!dispatcher._oauth.useCodeChallenge;

    return {
      url: authorizationURL
        .replace(/\{\{clientId\}\}/gi, encodeURIComponent(clientId))
        .replace(/\{\{scope\}\}/gi, encodeURIComponent(scopes)),
      useCodeChallenge,
    };
  };
}