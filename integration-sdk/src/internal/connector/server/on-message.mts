import { handlePacketError, reply } from "../../util/index.mjs";

export const onMessage = (processPacket: any) => { return async (packet, transport) => {
  try {
    const ret = await processPacket(packet);
    if (ret) reply(ret, packet, transport);
  } catch (e) {
    console.log(e);
    handlePacketError(packet, e, transport);
  }
}};