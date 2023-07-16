import JWE from "./index.mjs";

const main = async () => {
  const jwe = new JWE({});
  await jwe.newPair();

  console.log("PRIVATE_KEY=" + (await jwe.exportPrivateAsBase64()));
  console.log("PUBLIC_KEY=" + (await jwe.exportPublicAsBase64()));
};

setTimeout(() => null, 100);
main();
