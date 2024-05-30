import fs from "node:fs";
import * as YAML from 'yaml';
import { build } from "./build.mjs";


const verifyApiKey = () => {
  if (!process.env.ALOMA_KEY) {
    throw new Error(`Missing API key

Go to https://home.aloma.io/api and create an API key.
Set it as an environment variable:

ALOMA_KEY="12345"`);
  }
};

declare type Workspace = {
  name: string;
  id: string;
};

declare type Step = {
  name: string;
  id: string;
  content: { if: string; do: string };
  nocode_type?: string;
  version: number;
  enabled: boolean;
  content_hash?: string;
  valid: boolean;
  updatedAt: string;
};

const request = async (url: string, options: any): Promise<any> => {
  verifyApiKey();

  options ||= {};
  options.headers ||= {};
  options.headers.Authorization ||= `Bearer ${process.env.ALOMA_KEY}`;

  const ret = await fetch(url, options);
  const text = await ret.text();

  if (ret.status > 399) {
    const e: any = new Error(`${ret.status}: ${text}`);
    e.code = ret.status;

    throw e;
  }

  try {
    return JSON.parse(text);
  } catch (e: any) {
    throw new Error(`${e.message}: ${text}`);
  }
};

const graphql = async (query: string, variables: any = {}): Promise<any> => {
  const ret = await request(`https://graph.aloma.io/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = ret?.data;

  if (!data) {
    return data;
  }

  if (Object.keys(data).length === 1) {
    return Object.entries(data)[0][1];
  }

  return data;
};

const getWorkspace = async (id: string): Promise<Workspace> => {
  try
  {
    const workspace = await graphql(
      `
        query ($id: ID!) {
          getAutomationEnvironment(id: $id) {
            id
            name
          }
        }
      `,
      { id },
    );

    return workspace;
  } catch(e: any) {
    throw new Error(`id: ${id} ${e.message}`, e);
  }
};

const getSteps = async (id: string): Promise<Step[]> => {
  const steps = await graphql(
    `
      query ($id: ID!) {
        listAutomationSteps(id: $id) {
          id
          name
          content
          nocode_type
          version
          enabled
          content_hash
          valid
          updatedAt
        }
      }
    `,
    { id },
  );

  return steps;
};

const getTarget = (): string => {
  const target = `./src/steps/`;

  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  return target;
};

const processStep = async (
  target: string,
  workspace: Workspace,
  step: Step,
) => {
  console.log(`  ${step.name} (id: ${step.id}) ...`);

  const parts = step.name
    .split(/\//)
    .map((what) => what.trim())
    .filter((what) => !!what && !what.startsWith("."));
  const fileName = parts.pop();
  const path = `${target}/${parts.join("/")}`;
  const targetFile = `${path}/${fileName}.mts`;

  fs.mkdirSync(path, { recursive: true });

  const content = `/**
  Name:       ${step.name}

  ID:         ${step.id}
  Version:    ${step.version}
  Path:       ${targetFile.replace(/\/\/+/gi, "/")}
  UpdatedAt:  ${step.updatedAt}

  Workspace:  ${workspace.id}
*/

// @ts-nocheck

export const match = () => (${step.content.if});

export default async (data: any) => {
${step.content.do}
}
`;
  fs.writeFileSync(targetFile, content, { encoding: "utf-8" });
};

const processSteps = async (
  target: string,
  workspace: Workspace,
  steps: Step[],
) => {
  steps = steps.filter(
    (step) => step.enabled && !step.nocode_type && step.name,
  );

  for (let i = 0; i < steps.length; ++i) {
    await processStep(target, workspace, steps[i]);
  }
};

export const pull = async (id: string, options: any) => {
  const workspace = await getWorkspace(id);
  console.log(
    `Updating from workspace ${workspace.name} (id: ${workspace.id}) ...`,
  );

  const steps = await getSteps(id);
  const target = getTarget();

  await processSteps(target, workspace, steps);

  console.log(`Update successful.`);

  await build();
};

const yamlError = () => {
  throw new Error(`Missing config file

Create or change .aloma.yaml adding the following contents:

pull:
  workspaces:
    - a-workspace-id
`);
}

export const pullAll = async (options: any) => {
  if (!fs.existsSync('./.aloma.yaml')) {
    yamlError();
  }

  const config = YAML.parse(fs.readFileSync('./.aloma.yaml', {encoding: 'utf-8'}));

  if (config?.pull?.workspaces?.length)
  {
    const workspaces: string[] = config.pull.workspaces;
    for (let i = 0; i < workspaces.length; ++i) {
      await pull(workspaces[i], options);
    }
  } else {
    yamlError();
  }
}
