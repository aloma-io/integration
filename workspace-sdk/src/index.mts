import fs from 'node:fs';
import parseSteps from "./step-parser/index.mjs";

export const main = async () => 
{
  const dir = `${process.cwd()}/`
  fs.mkdirSync(`${dir}export/steps`, {recursive: true});

  const items = await parseSteps(`${dir}build/steps/`);
  
  let haveError = false;
  
  items.forEach((item) => 
  {
    const step = item.step;
    console.log(`[${step.errors?'ERR':'OK'}]\t${step.name}`);

    if (step.errors) {
      haveError = true;
    }
    
    const out = `${dir}/export/steps/${step.name.replaceAll(/[\/ ]+/gi, "__")}.step.json`

    fs.writeFileSync(out, JSON.stringify(step));
  });

  process.exit(haveError?-1:0);
};