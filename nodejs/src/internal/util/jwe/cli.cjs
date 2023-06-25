const JWE = require('./index');

const main = async () => {
  const jwe = new JWE({});
  await jwe.newPair();

  console.log('private key');
  console.log(await jwe.exportPrivateAsBase64());
  console.log('public key');
  console.log(await jwe.exportPublicAsBase64());
};

setTimeout(() => null, 100);
main();
