const {Connector}  = require('@aloma-io/integration-sdk');
const {Controller} = require('./controller');

const connector    = new Connector({id: 'TODO your connector id', version: '1.0.0'});
const controller   = new Controller();

connector.configure()
  // types are the calls available in the step, these are typescript definitions
  .types
  (`
    declare function hello(arg: {}): any;
  `)
  // resolvers hold the calls
  .resolvers
  ({
    hello: async (args) => 
    {
      return controller.hello(args);
    },
  })
  // main will be called once the connector is connected
  .main(({newTask, config}) =>
  {
    // the config might have changed, so the connector should be able to deal with multiple setConfigs over it's lifetime
    controller.setConfig({newTask, config});
  });  

// start the connector
connector.run();
