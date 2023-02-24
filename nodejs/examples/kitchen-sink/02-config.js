const {Connector}  = require('@aloma-io/integration-sdk');

const connector    = new Connector({id: 'TODO your connector id', version: '1.0.0'});

connector.configure()
  // these config fields can be configured from the aloma ui. these require a private and a public key which the connector will generate on start
  .config({fields: 
  {
    // this is then available from config.type
    type: {
      // name and placeholder for ui configuration
      name: 'Database Type',
      placeholder: 'e.g. mysql, pg, tedious',
      // type
      type: 'line',
      // this is an unencrypted value, by default everything is encrypted
      plain: true
    },
    user: {
      name: 'User',
      placeholder: 'e.g. john',
      type: 'line',
      plain: true,
      // this is marked as optional in the ui, so does not have to be provided, everything else is mandatory
      optional: true
    },
    // this is encrypted in the ui via public key, can only be decrypted by the connector having the private key
    password: {
      name: 'Password',
      placeholder: 'e.g. x3gsadg',
      type: 'line',
      optional: true
    },
 
  }})
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
  .main(({newTask, config}) =>
  {
    console.log(config.type)
    console.log(config.password)
    console.log(config.user)
  });  

connector.run();
