import JSHINT from 'jshint';
import {createHash} from 'node:crypto';
import fs from 'node:fs';

const jshint = JSHINT.JSHINT;

const digestStepContent = (what) => {
  return createHash('sha256').update(what).digest('hex');
};

const stripFunction = (what: string) => {
  what = what.trim();

  let stripped: any = what.split(/\{/gi);

  stripped.shift();
  stripped = stripped.join('{');

  stripped = stripped.split(/\}/gi);
  stripped.pop();
  stripped = stripped.join('}');

  return stripped.trim();
};

const validate = ({if: ifContent, do: doContent}) => {
  const ok = jshint(
    `(async () => {
    ${notEmpty(doContent, 'do')}
    })()`,
    {
      esversion: 9,
      asi: true,
      eqnull: true,
      '-W032': true,
      '-W083': true,
      '-W119': true,
      '-W014': true,
    }
  );

  const errors = [...jshint.errors].map((error) => ({
    ...error,
    line: error.line - 1,
  }));

  if (!ok) {
    return errors;
  }
};

const notEmpty = (what: string, name: string) => {
  if (!what?.trim()) throw new Error(`${name} cannot be empty`);

  return what;
};

const parseStep = ({name, disabled, default: defaultImport, match}) => {
  const content = {
    if: `{${stripFunction(match.toString())}}`,
    do: stripFunction(defaultImport.toString()),
    enabled: !disabled,
    valid: false,
  };

  const errors = validate(content);
  content.valid = !errors;

  const json = JSON.stringify(content);
  const hash = digestStepContent(json);

  return {content, json, hash, name, errors};
};

const walkSync = function (dir: string, filter: any, filelist: string[] = []) {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    if (fs.statSync(dir + '/' + file).isDirectory()) {
      filelist = [...filelist, ...walkSync(dir + '/' + file + '/', filter, filelist)];
    } else if (filter(file)) {
      filelist.push(`${dir}/${file}`.replace(/\/\/+/gi, '/'));
    }
  });

  return [...new Set(filelist)];
};

const parseSteps = async (root: string) => {
  const files = walkSync(root, (file) => file.endsWith('.mjs')).map((file) =>
    file.substring(root.length).replace(/^\/+/gi, '')
  );

  const items = files
    .map(async (file) => {
      return {file, source: await import(`${root}/${file}`)};
    })
    .map(async (arg: any) => {
      const {file, source} = await arg;
      return {path: file, name: file.replace(/\.mjs$/gi, ''), ...source};
    })
    .map(async (source) => {
      return {source: await source, step: parseStep(await source)};
    });

  let transformed = await Promise.all(items);

  transformed = transformed.sort((a: any, b: any) => (a.source.path > b.source.path ? -1 : 1));

  return transformed;
};

export default parseSteps;
