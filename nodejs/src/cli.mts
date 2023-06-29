#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
      fs.mkdirSync(`${target}/${dir}`, {recursive: true});
    }

    const content = fs.readFileSync(`${source}/${dir}/${name}`, {
      encoding: "utf-8",
    });
    fs.writeFileSync(`${target}/${dir}/${name}`, content);
  });

  const content = JSON.parse(
    fs.readFileSync(`${target}/package.json`, { encoding: "utf-8" })
  );

  content.name = name;
  content.connectorId = connectorId;

  fs.writeFileSync(`${target}/package.json`, JSON.stringify(content, null, 2));
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
  .action((name, options) => {
    name = name.replace(/[\/\.]/gi, "");
    if (!name) throw new Error("name is empty");

    const target = `${process.cwd()}/${name}`;

    fs.mkdirSync(target);

    extract({ ...options, target, name });
  });

program.parse();
