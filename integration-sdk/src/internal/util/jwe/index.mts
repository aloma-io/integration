import * as jose from "jose";

class JWE {
  issuer: string;
  algorithm: string;
  pair?: jose.GenerateKeyPairResult<jose.KeyLike>;
  constructor({ algorithm = "PS256" }) {
    this.issuer = "home.aloma.io";
    this.algorithm = algorithm;
  }

  async newPair() {
    this.pair = await jose.generateKeyPair(this.algorithm);
  }

  async exportPair() {
    return {
      publicKey: await jose.exportSPKI(this.pair!.publicKey),
      privateKey: await jose.exportPKCS8(this.pair!.privateKey),
    };
  }

  async exportPrivateAsBase64() {
    const pair = await this.exportPair();

    return Buffer.from(pair.privateKey).toString("base64");
  }

  async exportPublicAsBase64() {
    const pair = await this.exportPair();

    return Buffer.from(pair.publicKey).toString("base64");
  }

  async importPair({ publicKey, privateKey, algorithm }) {
    this.pair = {
      publicKey: await jose.importSPKI(publicKey, algorithm),
      privateKey: await jose.importPKCS8(privateKey, algorithm),
    };
  }

  async importBase64Pair({ publicKey, privateKey, algorithm }) {
    this.importPair({
      publicKey: Buffer.from(publicKey, "base64").toString(),
      privateKey: Buffer.from(privateKey, "base64").toString(),
      algorithm,
    });
  }

  async encrypt(what, expiration = "7d", audience, algorithm = "RSA-OAEP-256") {
    const item = new jose.EncryptJWT({ _data: { ...what } })
      .setProtectedHeader({ alg: algorithm, enc: "A256GCM" })
      .setIssuedAt()
      .setIssuer(this.issuer)
      .setAudience(audience);

    if (expiration && expiration !== "none") item.setExpirationTime(expiration);

    return await item.encrypt(this.pair!.publicKey);
  }

  async decrypt(what, audience) {
    const { payload, protectedHeader } = await jose.jwtDecrypt(
      what,
      this.pair!.privateKey,
      {
        issuer: this.issuer,
        audience,
      },
    );

    return payload._data;
  }
}

export default JWE;
