#!/usr/bin/env node

import { Command } from "commander";
import ChildProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import util from "node:util";
import { main } from "./index.mjs";

const exec = util.promisify(ChildProcess.exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = [
  { name: "greeting done.mts", dir: "src/steps/and-done/" },
  { name: "hello world.mts", dir: "src/steps/" },
  { name: "package.json", dir: "" },
  { name: "tsconfig.json", dir: "" },
];

const extract = ({ target, name, connectorId }) => {
  const source = `${__dirname}/../template/workspace/`;

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

const program = new Command();

program
  .name("npx @aloma.io/workspace-sdk")
  .description("aloma.io workspace sdk")
  .version("0.8.0")
  .showHelpAfterError();

program
  .command("create")
  .description("Create a new workspace project")
  .argument("<name>", "name of the project")
  .action(async (name, options) => {
    name = name.replace(/[\/\.]/gi, "");
    if (!name) throw new Error("name is empty");

    const target = `${process.cwd()}/${name}`;

    fs.mkdirSync(target);

    console.log("Creating workspace ...");
    extract({ ...options, target, name });

    console.log("Installing dependencies ...");
    await exec(`cd ${target}; yarn`);

    console.log("Building ...");
    await exec(`cd ${target}; yarn build`);

    console.log(`
Success!
      
1.) Create a new workspace in aloma
2.) Push the project to a git repository
3.) Configure workspace source sync in aloma
`)
  });

  program
  .command("build")
  .description("Build the current project")
  .action(async (options) => {
     await main()
  });

program.parse();
