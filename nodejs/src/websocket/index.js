
const WebSocket = require('ws');
const {Connection}  = require('./connection')
const {Transport}   = require('./transport')
const url       = require('url');
const noop      = () => {};
const heartbeat = (ws) => 
{
  ws.isAlive = true;
};

class WebsocketConnector
{
  constructor({config, onMessage, onConnect})
  {
    var local                 = this;
    this.config    = config;
    this.transport = new Transport({config, onMessage, onConnect})
  }
  
  async start()
  {
    var local    = this;
    const config = this.config
    
    local.connection = new Connection({config, onStart: () => 
    {
      local.transport.start(() => setTimeout(() => local.start(), 1000));
    }})
    
    await local.connection.start();
  }
  
  send(message)
  {
    if (!message) return;
    
    this.transport.send(this.transport.newPacket(message));
  }
  
  async close()
  {
    var local = this;
    
    if (local.ws) await local.ws.close();

  }
  
  async leaving()
  {
    var local = this;
    
    if (local.connection) await local.connection.close();
  }
}

module.exports = {WebsocketConnector}