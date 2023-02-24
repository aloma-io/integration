const {Connector}  = require('@aloma-io/integration-sdk');

const connector    = new Connector({id: 'TODO your connector id', version: '1.0.0'});

connector.configure()
  // these require a private and a public key which the connector will generate on start
  // after a connector is added to a workspace it can be connected from the aloma ui
  .oauth
  ({
    // the authorization url, the placeholders {{clientId}}, {{redirectURI}}, {{scope}} will be filled in by aloma
    authorizationURL: 'https://github.com/login/oauth/authorize?client_id={{clientId}}&redirect_uri={{redirectURI}}&scope={{scope}}&allow_signup=false',
    tokenURL: 'https://github.com/login/oauth/access_token',
    clientId: 'clientId',
    clientSecret: 'clientSecret',
    scope: 'repo, user:email'
  })
  .types
  (`
    hello(arg: {}): any;
  `)
  .resolvers
  ({
    hello: async (args) => 
    {
      return "world";
    },
  })
  .main(({newTask, config, oauth}) =>
  {
    // one can access oauth.accessToken()
    // one can get a fetch client: oauth.getClient()
    // the client supports retries and will also do an automatic token refresh if a refresh_token is provided
    // oauth.getClient().fetch({url, options = {method: 'POST', headers: {}, body: ''})
  });  

connector.run();
