import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { notEmpty } from "../internal/util/index.mjs";
import RuntimeContext from "./runtime-context.mjs";

const offset = '/../../../../../'; 

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    await this.parsePackageJson();
    await this.loadTypes();
    await this.checkIcon();

    // @ts-ignore
    const Controller = (
      await import(__dirname + offset + "build/controller/index.mjs")
    ).default;

    return new RuntimeContext(new Controller(), this.data);
  }

  private async checkIcon() {
    const data = this.data;
    const root = __dirname + offset;

    data.icon = `${root}/logo.png`;
  }

  private async parsePackageJson() {
    const data = this.data;

    const packageJson = JSON.parse(
      fs.readFileSync(__dirname + offset + "package.json", {
        encoding: "utf-8",
      }),
    );

    notEmpty((data.id = packageJson.connectorId), "id");
    notEmpty((data.version = packageJson.version), "version");
  }

  private async loadTypes() {
    notEmpty(this.data.controller, "controller");

    const content = fs.readFileSync(this.data.controller, {encoding: 'utf-8'});
    const {text, methods} = JSON.parse(content);

    this.data.types = text;
    this.data.methods = methods;
  }
}
