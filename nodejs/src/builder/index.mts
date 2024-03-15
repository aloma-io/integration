import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { notEmpty } from "../internal/util/index.mjs";
import RuntimeContext from "./runtime-context.mjs";

const DIR_OFFSET = '/../../../../../'; 

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TARGET_DIR = `${__dirname}${DIR_OFFSET}`;

export class Builder {
  private data: any = {
    controller: "./build/.controller.json",
  };

  config(arg: any): Builder {
    this.data.config = arg;

    return this;
  }

  options(arg: any): Builder {
    this.data.options = arg;

    return this;
  }

  auth(arg: any): Builder {
    this.data.auth = arg;
    return this;
  }

  async build(): Promise<RuntimeContext> {
    await this.loadDescriptor();
    await this.checkIcon();

    // @ts-ignore
    const Controller = (
      await import(TARGET_DIR + "build/controller/index.mjs")
    ).default;

    return new RuntimeContext(new Controller(), this.data);
  }

  private async checkIcon() {
    const data = this.data;
    const root = TARGET_DIR;

    data.icon = `${root}/logo.png`;
  }

  private async loadDescriptor() {
    notEmpty(this.data.controller, "controller");

    const content = fs.readFileSync(this.data.controller, {encoding: 'utf-8'});
    const {text, methods, connectorId, version} = JSON.parse(content);

    this.data.types = text;
    this.data.methods = methods;

    notEmpty((this.data.id = connectorId), "id");
    notEmpty((this.data.version = version), "version");
  }
}