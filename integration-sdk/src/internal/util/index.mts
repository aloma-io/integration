export const handlePacketError = (packet, e, transport) => {
  if (!packet.cb()) {
    console.dir({ msg: "packet error", e, packet }, { depth: null });
    return;
  }

  transport.send(transport.newPacket({ c: packet.cb(), a: { error: "" + e } }));
};

export const reply = (arg, packet, transport) => {
  if (!packet.cb()) {
    console.dir(
      { msg: "cannot reply to packet without cb", arg, packet },
      { depth: null },
    );
    return;
  }

  transport.send(transport.newPacket({ c: packet.cb(), a: { ...arg } }));
};

export const unwrap0 = (ret, body, options) => {
  if (options?.bodyOnly === false) {
    return { status: ret.status, headers: ret.headers, body };
  } else {
    return body;
  }
};

export const unwrap = async (ret, options) => {
  if (options?.text) return unwrap0(ret, await ret.text(), options);
  if (options?.base64) {
    const base64 = Buffer.from(await ret.arrayBuffer()).toString("base64");

    return unwrap0(ret, base64, options);
  }

  if (options?.skipResponseBody) {
    return { status: ret.status, headers: ret.headers };
  }

  const text = await ret.text();

  try {
    return unwrap0(ret, JSON.parse(text), options);
  } catch (e) {
    throw e + " " + text;
  }
};

export const notEmpty = (what, name) => {
  if (!what?.trim()) throw new Error(`${name} cannot be empty`);

  return what;
};
