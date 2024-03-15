#!/usr/bin/env node

import { Command } from "commander";
import ChildProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import util from "node:util";
import { TARGET_DIR } from "./builder/index.mjs";
import { notEmpty } from "./internal/util/index.mjs";
import JWE from "./internal/util/jwe/index.mjs";
import parseTypes from "./transform/index.mjs";

const exec = util.promisify(ChildProcess.exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = [
  { name: "index.mts", dir: "src/controller" },
  { name: "index.mts", dir: "src" },
  { name: "package.json", dir: "" },
  { name: "Containerfile", dir: "" },
  { name: "entrypoint.sh", dir: "" },
  { name: "tsconfig.json", dir: "" },
];

const extract = ({ target, name, connectorId }) => {
  const source = `${__dirname}/../template/connector/`;

  if (!fs.existsSync(source)) {
    throw new Error(`source ${source} does not exist`);
  }

  files.forEach(({ name, dir }) => {
    if (dir) {
      fs.mkdirSync(`${target}/${dir}`, { recursive: true });
    }

    const content = fs.readFileSync(`${source}/${dir}/${name}`, {
      encoding: "utf-8",
    });
    fs.writeFileSync(`${target}/${dir}/${name}`, content);
  });

  const content = JSON.parse(
    fs.readFileSync(`${target}/package.json`, { encoding: "utf-8" }),
  );

  content.name = name;
  content.connectorId = connectorId;

  fs.writeFileSync(`${target}/package.json`, JSON.stringify(content, null, 2));
  fs.writeFileSync(
    `${target}/.gitignore`,
    `.DS_Store
node_modules
build
.env
yarn-error.log`,
  );
};

const generateKeys = async ({ target }) => {
  const jwe = new JWE({});
  await jwe.newPair();

  const priv = await jwe.exportPrivateAsBase64();
  const pub = await jwe.exportPublicAsBase64();

  const content = `REGISTRATION_TOKEN=
PRIVATE_KEY=${priv}
PUBLIC_KEY=${pub}
`;

  fs.writeFileSync(`${target}/.env`, content);
};

const program = new Command();

program
  .name("npx @aloma.io/integration-sdk")
  .description("aloma.io integration sdk")
  .version("0.8.0")
  .showHelpAfterError();

program
  .command("create")
  .description("Create a new connector project")
  .argument("<name>", "name of the project")
  .requiredOption("--connector-id <id>", "id of the connector")
  .action(async (name, options) => {
    name = name.replace(/[\/\.]/gi, "");
    if (!name) throw new Error("name is empty");

    const target = `${process.cwd()}/${name}`;

    fs.mkdirSync(target);

    console.log("Creating connector ...");
    extract({ ...options, target, name });

    console.log("Generating keys ...");
    await generateKeys({ target });

    console.log("Installing dependencies ...");
    await exec(`cd ${target}; yarn`);

    console.log("Building ...");
    await exec(`cd ${target}; yarn build`);

    console.log(`
Success!
      
1.) Add the connector to a workspace
2.) Edit ./${name}/.env and insert the registration token
3.) Start the connector with cd ./${name}/; yarn start`);
  });

program
  .command("build")
  .description("Build the current connector project")
  .action(async (str, options) => {
    const { stdout, stderr } = await exec(
      `rm -rf build; mkdir -p build`,
    );

    if (stdout) console.log(stdout);

    new Extractor().extract('./src/controller/index.mts', './build/.controller.json')
  });

class Extractor {
  async extract(source, target) {
    notEmpty(source, "source");

    fs.readFileSync(source);
    const { text, methods } = await parseTypes(source);

    const packageJson = JSON.parse(
      fs.readFileSync(TARGET_DIR + "package.json", {
        encoding: "utf-8",
      }),
    );

    fs.writeFileSync(target, JSON.stringify({text, methods, connectorId: packageJson.connectorId, version: packageJson.version}), {encoding: 'utf-8'})
  }
}

program.parse();
