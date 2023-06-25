const {Packet, Callback} = require('./packet.cjs');

class Processor {
  constructor({transport, processPacket}) {
    var local = this;

    this.transport = transport;
    this._processPacket = processPacket;
  }

  async onMessages(what) {
    var local = this;
    const messages = what.p;

    const packets = messages.map((message) => {
      const packet = new Packet(message);
      local.transport.acks.push(packet.id());

      return local.processPacket(packet);
    });

    await Promise.all(packets);
  }

  async processPacket(packet) {
    var local = this;

    if (packet.args().packet) {
      await local.processPacket0(local.transport.newPacket(packet.args().packet), packet);
    } else {
      await local.processPacket0(packet, packet);
    }
  }

  async processPacket0(packet, original) {
    var local = this,
      callbacks = local.transport.callbacks;

    if (packet.cb() && callbacks[packet.cb()]) {
      try {
        callbacks[packet.cb()](packet.args());
      } catch (e) {
        console.log('error in callback', callbacks[packet.cb()], packet);
      }

      delete local.transport.callbacks[packet.cb()];
    } else if (packet.event()) {
      console.log('handle event packet', packet);
    } else {
      try {
        const result = await local._processPacket(packet);
        const reply = local.transport.newPacket({});

        reply.method('connector.reply');
        reply.cb(original.cb());
        reply.args({...result});

        local.transport.send(reply);
      } catch (e) {
        console.log('error processing packet', e, packet);
      }
    }
  }
}

module.exports = {Processor};
