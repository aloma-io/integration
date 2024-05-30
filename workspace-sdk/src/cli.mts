#!/usr/bin/env node

import { Command } from "commander";
import { build } from "./commands/build.mjs";
import { create } from "./commands/create.mjs";
import { pull, pullAll } from "./commands/pull.mjs";

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
    await create(name, options);
  });

program
  .command("build")
  .description("Build the current project")
  .action(async (options) => {
    const haveError = await build();

    process.exit(haveError ? -1 : 0);
  });

program
  .command("pull")
  .description("Pull a workspace into the current project")
  .argument("[id]", "id of the workspace")
  .action(async (id, options) => {
    if (id) {
      await pull(id, options);
    } else {
      await pullAll(options);
    }
  });

program.parse();
