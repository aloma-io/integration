import fs from "node:fs";
import parseTypes from "./transform/index.mjs";
import RuntimeContext from "./runtime-context.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const notEmpty = (what, name) => {
  if (!what?.trim()) throw new Error(`${name} cannot be empty`);

  return what;
};

export class Builder {
  private data: any = {
    controller: "./build/controller/.controller-for-types.mts",
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
    await this.parsePackageJson();
    await this.discoverTypes();

    // @ts-ignore
    const Controller = (
      await import(__dirname + "/../../../../../build/controller/index.mjs")
    ).default;

    return new RuntimeContext(new Controller(), this.data);
  }

  private async parsePackageJson() {
    const data = this.data;

    const packageJson = JSON.parse(
      fs.readFileSync(__dirname + "/../../../../../package.json", {
        encoding: "utf-8",
      }),
    );

    notEmpty((data.id = packageJson.connectorId), "id");
    notEmpty((data.version = packageJson.version), "version");
  }

  private async discoverTypes() {
    notEmpty(this.data.controller, "controller");

    const content = fs.readFileSync(this.data.controller);
    const { text, methods } = await parseTypes(this.data.controller);

    this.data.types = text;
    this.data.methods = methods;
  }
}
