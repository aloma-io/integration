import ChildProcess from "node:child_process";
import fs from "node:fs";
import util from "node:util";
import parseSteps from "../step-parser/index.mjs";

const exec = util.promisify(ChildProcess.exec);
export const build = async () => {
  console.log(`Building ...`);
  const dir = `${process.cwd()}/`;

  await exec(`yarn run tsc`);

  fs.mkdirSync(`${dir}export/steps`, { recursive: true });

  const items = await parseSteps(`${dir}build/steps/`);

  let haveError = false;

  items.forEach((item) => {
    const step = item.step;
    console.log(`[${step.errors ? "ERR" : "OK"}]\t${step.name}`);

    if (step.errors) {
      haveError = true;
    }

    const out = `${dir}/export/steps/${step.name.replaceAll(/[\/ ]+/gi, "__")}.step.json`;

    fs.writeFileSync(out, JSON.stringify(step));
  });

  console.log(haveError ? "ERROR." : "OK.");

  return !!haveError;
};
