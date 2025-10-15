#!/usr/bin/env node

import {Command} from 'commander';
import ChildProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import util from 'node:util';
import {TARGET_DIR} from './builder/index.mjs';
import {notEmpty} from './internal/util/index.mjs';
import JWE from './internal/util/jwe/index.mjs';
import parseTypes from './transform/index.mjs';
import {OpenAPIToConnector} from './openapi-to-connector.mjs';

const exec = util.promisify(ChildProcess.exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = [
  {name: 'index.mts', dir: 'src/controller'},
  {name: 'index.mts', dir: 'src'},
  {name: 'package.json', dir: ''},
  {name: 'Containerfile', dir: ''},
  {name: 'entrypoint.sh', dir: ''},
  {name: 'tsconfig.json', dir: ''},
];

const extract = ({target, name, connectorId}) => {
  const source = `${__dirname}/../template/connector/`;

  if (!fs.existsSync(source)) {
    throw new Error(`source ${source} does not exist`);
  }

  files.forEach(({name, dir}) => {
    if (dir) {
      fs.mkdirSync(`${target}/${dir}`, {recursive: true});
    }

    const content = fs.readFileSync(`${source}/${dir}/${name}`, {
      encoding: 'utf-8',
    });
    fs.writeFileSync(`${target}/${dir}/${name}`, content);
  });

  const content = JSON.parse(fs.readFileSync(`${target}/package.json`, {encoding: 'utf-8'}));

  content.name = name;
  content.connectorId = connectorId;

  fs.writeFileSync(`${target}/package.json`, JSON.stringify(content, null, 2));
  fs.writeFileSync(
    `${target}/.gitignore`,
    `.DS_Store
node_modules
build
.env
yarn-error.log`
  );
};

const generateKeys = async ({target}) => {
  const jwe = new JWE({});
  await jwe.newPair();

  const priv = await jwe.exportPrivateAsBase64();
  const pub = await jwe.exportPublicAsBase64();

  const content = `REGISTRATION_TOKEN=
PRIVATE_KEY=${priv}
PUBLIC_KEY=${pub}
`;

  fs.writeFileSync(`${target}/.env`, content);
};

const program = new Command();

program
  .name('npx @aloma.io/integration-sdk')
  .description('aloma.io integration sdk')
  .version('0.8.0')
  .showHelpAfterError();

program
  .command('create')
  .description('Create a new connector project')
  .argument('<name>', 'name of the project')
  .requiredOption('--connector-id <id>', 'id of the connector')
  .action(async (name, options) => {
    name = name.replace(/[\/\.]/gi, '');
    if (!name) throw new Error('name is empty');

    const target = `${process.cwd()}/${name}`;

    fs.mkdirSync(target);

    console.log('Creating connector ...');
    extract({...options, target, name});

    console.log('Generating keys ...');
    await generateKeys({target});

    console.log('Installing dependencies ...');
    await exec(`cd ${target}; yarn --ignore-engines`);

    console.log('Building ...');
    await exec(`cd ${target}; yarn build`);

    console.log(`
Success!
      
1.) Add the connector to a workspace
2.) Edit ./${name}/.env and insert the registration token
3.) Start the connector with cd ./${name}/; yarn start`);
  });

program
  .command('build')
  .description('Build the current connector project')
  .action(async (str, options) => {
    const {stdout, stderr} = await exec(`rm -rf build; mkdir -p build; `);

    try {
      fs.copyFileSync(`${TARGET_DIR}/logo.png`, `${TARGET_DIR}/build/logo.png`);
    } catch (e) {
      // blank
    }

    if (stdout) console.log(stdout);

    new Extractor().extract('./src/controller/index.mts', './build/.controller.json');
  });

program
  .command('from-openapi')
  .description('Generate a connector controller from an OpenAPI specification')
  .argument('<name>', 'name of the connector project')
  .requiredOption('--connector-id <id>', 'id of the connector')
  .requiredOption('--spec <file>', 'OpenAPI specification file (JSON or YAML)')
  .option('--out <file>', 'output file path for the controller', 'src/controller/index.mts')
  .option(
    '--resource <className>',
    'Generate as a resource class with the specified class name (e.g., CompaniesResource)'
  )
  .option('--multi-resource', 'Generate multiple resource files + main controller (requires multiple --spec files)')
  .option('--controller-only', 'Generate only the controller file, do not create full project structure')
  .option('--no-build', 'Skip installing dependencies and building the project')
  .action(async (name, options) => {
    name = name.replace(/[\/\.]/gi, '');
    if (!name) throw new Error('name is empty');

    try {
      // Read and parse the OpenAPI spec
      const specContent = fs.readFileSync(options.spec, 'utf-8');
      const spec = OpenAPIToConnector.parseSpec(specContent);

      // Generate the controller from OpenAPI spec
      const generator = new OpenAPIToConnector(spec, name);
      let controllerCode: string;

      if (options.resource) {
        console.log(`Generating resource class '${options.resource}' from OpenAPI specification...`);
        controllerCode = generator.generateResourceClass(options.resource);
      } else {
        console.log('Generating controller from OpenAPI specification...');
        controllerCode = generator.generateController();
      }

      if (options.controllerOnly) {
        // Controller-only mode: just generate the controller file
        const controllerPath = path.resolve(options.out);
        fs.mkdirSync(path.dirname(controllerPath), {recursive: true});
        fs.writeFileSync(controllerPath, controllerCode);

        console.log(`\n✅ Success! Generated controller from OpenAPI specification
📝 Connector name: ${name}
📊 Found ${generator.getOperationsCount()} operations
📄 Controller file: ${controllerPath}
      
Controller file generated successfully! You can now use it in your existing project.`);
      } else {
        // Full project mode: create complete project structure
        const target = `${process.cwd()}/${name}`;

        // Create the connector project structure
        fs.mkdirSync(target);
        console.log('Creating connector project...');
        extract({...options, target, name});

        // Write the generated controller
        const controllerPath = `${target}/${options.out}`;
        fs.mkdirSync(path.dirname(controllerPath), {recursive: true});
        fs.writeFileSync(controllerPath, controllerCode);

        console.log('Generating keys...');
        await generateKeys({target});

        if (options.build !== false) {
          console.log('Installing dependencies...');
          await exec(`cd ${target}; yarn --ignore-engines`);

          console.log('Building...');
          await exec(`cd ${target}; yarn build`);
        }

        const nextSteps =
          options.build !== false
            ? `Next steps:
1.) Add the connector to a workspace
2.) Edit ./${name}/.env and insert the registration token
3.) Implement the actual API calls in each method in ${options.out}
4.) Start the connector with cd ./${name}/; yarn start`
            : `Next steps:
1.) Install dependencies: cd ./${name}/ && yarn --ignore-engines
2.) Implement the actual API calls in each method in ${options.out}
3.) Build the project: yarn build
4.) Add the connector to a workspace
5.) Edit ./${name}/.env and insert the registration token
6.) Start the connector: yarn start`;

        console.log(`\n✅ Success! Generated connector from OpenAPI specification
📝 Connector name: ${name}
📊 Found ${generator.getOperationsCount()} operations
📄 Controller generated: ${options.out}
      
${nextSteps}`);
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
      
      // Clean up on error (only if we created a project directory)
      if (!options.controllerOnly) {
        const target = `${process.cwd()}/${name}`;
        if (fs.existsSync(target)) {
          fs.rmSync(target, {recursive: true, force: true});
        }
      }
      
      process.exit(1);
    }
  });

class Extractor {
  async extract(source, target) {
    notEmpty(source, 'source');

    fs.readFileSync(source);
    const {text, methods} = await parseTypes(source);

    const packageJson = JSON.parse(
      fs.readFileSync(TARGET_DIR + 'package.json', {
        encoding: 'utf-8',
      })
    );

    fs.writeFileSync(
      target,
      JSON.stringify({
        text,
        methods,
        connectorId: packageJson.connectorId,
        version: packageJson.version,
      }),
      {encoding: 'utf-8'}
    );
  }
}

// Multi-resource connector creation
program
  .command('create-multi-resource')
  .description('Create a multi-resource connector project with multiple OpenAPI specifications')
  .argument('<name>', 'name of the connector project')
  .requiredOption('--connector-id <id>', 'id of the connector')
  .requiredOption(
    '--resources <specs>',
    'comma-separated list of "className:specFile" pairs (e.g., "CompaniesResource:companies.json,ContactsResource:contacts.json")'
  )
  .option('--base-url <url>', 'base URL for the API (if not specified, will be extracted from first OpenAPI spec)')
  .option('--no-build', 'Skip installing dependencies and building the project')
  .action(async (name, options) => {
    name = name.replace(/[\/\.]/gi, '');
    if (!name) throw new Error('name is empty');

    const target = `${process.cwd()}/${name}`;

    try {
      // Parse resources specification
      const resourceSpecs = options.resources.split(',').map((spec) => {
        const [className, specFile] = spec.split(':');
        if (!className || !specFile) {
          throw new Error(`Invalid resource specification: ${spec}. Expected format: "ClassName:specFile"`);
        }
        return {className: className.trim(), specFile: specFile.trim()};
      });

      console.log(`Creating multi-resource connector '${name}' with ${resourceSpecs.length} resources...`);

      // Create the connector project structure
      fs.mkdirSync(target);
      extract({...options, target, name});

      // Generate each resource
      const resources: Array<{className: string; fileName: string}> = [];
      const parsedResourceSpecs: Array<{fileName: string; spec: any}> = [];
      let baseUrl = options.baseUrl;

      for (const {className, specFile} of resourceSpecs) {
        console.log(`Generating ${className} from ${specFile}...`);

        // Read and parse the OpenAPI spec
        const specContent = fs.readFileSync(specFile, 'utf-8');
        const spec = OpenAPIToConnector.parseSpec(specContent);

        // Extract base URL from first spec if not provided
        if (!baseUrl && spec.servers && spec.servers.length > 0) {
          baseUrl = spec.servers[0].url;
        }

        // Generate the resource class
        const generator = new OpenAPIToConnector(spec, name);
        const resourceCode = generator.generateResourceClass(className);

        // Write the resource file
        const fileName = className.toLowerCase().replace('resource', '');
        const resourcePath = `${target}/src/resources/${fileName}.mts`;
        fs.mkdirSync(path.dirname(resourcePath), {recursive: true});
        fs.writeFileSync(resourcePath, resourceCode);

        resources.push({className, fileName});
        parsedResourceSpecs.push({fileName, spec});
      }

      // Generate the main controller
      console.log('Generating main controller...');
      const firstSpec = OpenAPIToConnector.parseSpec(fs.readFileSync(resourceSpecs[0].specFile, 'utf-8'));
      const mainGenerator = new OpenAPIToConnector(firstSpec, name);
      const mainControllerCode = mainGenerator.generateMainController(resources, parsedResourceSpecs);

      // Write the main controller
      const controllerPath = `${target}/src/controller/index.mts`;
      fs.writeFileSync(controllerPath, mainControllerCode);

      console.log('Generating keys...');
      await generateKeys({target});

      if (options.build !== false) {
        console.log('Installing dependencies...');
        await exec(`cd "${target}"; yarn --ignore-engines`);

        console.log('Building...');
        await exec(`cd "${target}"; yarn build`);
      }

      const nextSteps =
        options.build !== false
          ? `Next steps:
1.) Add the connector to a workspace
2.) Edit ./${name}/.env and insert the registration token
3.) Start the connector with cd ./${name}/; yarn start`
          : `Next steps:
1.) Install dependencies: cd ./${name}/ && yarn --ignore-engines
2.) Build the project: yarn build
3.) Add the connector to a workspace
4.) Edit ./${name}/.env and insert the registration token
5.) Start the connector with yarn start`;

      console.log(`\n✅ Multi-resource connector created successfully!
      
Generated resources:
${resources.map((r) => `- ${r.className} (${r.fileName}.mts)`).join('\n')}

Main controller: src/controller/index.mts
${nextSteps}`);
    } catch (error) {
      console.error('Error creating multi-resource connector:', (error as Error).message);
      process.exit(1);
    }
  });

// Add resource to existing project
program
  .command('add-resource')
  .description('Add a new resource to an existing multi-resource connector')
  .argument('<projectPath>', 'path to the existing connector project')
  .requiredOption('--className <name>', 'class name for the resource (e.g., DealsResource)')
  .requiredOption('--spec <file>', 'OpenAPI specification file for the new resource')
  .option('--no-build', 'Skip building the project after adding the resource')
  .action(async (projectPath, options) => {
    const target = path.resolve(projectPath);

    if (!fs.existsSync(target)) {
      throw new Error(`Project path does not exist: ${target}`);
    }

    const controllerPath = `${target}/src/controller/index.mts`;
    if (!fs.existsSync(controllerPath)) {
      throw new Error(`Controller file not found: ${controllerPath}. This might not be a multi-resource connector project.`);
    }

    try {
      console.log(`Adding ${options.className} resource to existing project...`);

      // Read and parse the OpenAPI spec
      const specContent = fs.readFileSync(options.spec, 'utf-8');
      const spec = OpenAPIToConnector.parseSpec(specContent);

      // Generate the resource functions file (new function-based pattern)
      const generator = new OpenAPIToConnector(spec, 'Resource');
      const resourceCode = generator.generateResourceClass(options.className);

      // Write the resource file
      const fileName = options.className.toLowerCase().replace('resource', '');
      const resourcePath = `${target}/src/resources/${fileName}.mts`;
      fs.mkdirSync(path.dirname(resourcePath), {recursive: true});
      fs.writeFileSync(resourcePath, resourceCode);

      // Update the main controller to include the new resource
      console.log('Updating main controller...');
      let controllerContent = fs.readFileSync(controllerPath, 'utf-8');
      
      // Add import
      const importStatement = `import * as ${fileName}Functions from '../resources/${fileName}.mjs';`;
      if (!controllerContent.includes(importStatement)) {
        // Find the last import and add after it
        const importRegex = /^import.*from.*?;$/gm;
        const imports = controllerContent.match(importRegex);
        if (imports && imports.length > 0) {
          const lastImport = imports[imports.length - 1];
          controllerContent = controllerContent.replace(lastImport, `${lastImport}\n${importStatement}`);
        } else {
          // If no imports found, add at the beginning
          controllerContent = `${importStatement}\n\n${controllerContent}`;
        }
      }
      
      // Add property declaration
      const propertyDeclaration = `  ${fileName}: any = {};`;
      if (!controllerContent.includes(propertyDeclaration)) {
        // Find the existing properties and add the new one
        const propertyRegex = /^  \w+: any = \{\};$/gm;
        const properties = controllerContent.match(propertyRegex);
        if (properties && properties.length > 0) {
          const lastProperty = properties[properties.length - 1];
          controllerContent = controllerContent.replace(lastProperty, `${lastProperty}\n${propertyDeclaration}`);
        } else {
          // Add after class declaration
          controllerContent = controllerContent.replace(
            /^export default class Controller extends AbstractController \{$/gm,
            `export default class Controller extends AbstractController {\n${propertyDeclaration}`
          );
        }
      }
      
      // Add binding in start() method
      const bindingStatement = `    this.bindResourceFunctions('${fileName}', ${fileName}Functions);`;
      if (!controllerContent.includes(bindingStatement)) {
        // Find the existing bindings and add the new one
        const bindingRegex = /^    this\.bindResourceFunctions\(.*?\);$/gm;
        const bindings = controllerContent.match(bindingRegex);
        if (bindings && bindings.length > 0) {
          const lastBinding = bindings[bindings.length - 1];
          controllerContent = controllerContent.replace(lastBinding, `${lastBinding}\n${bindingStatement}`);
        }
      }
      
      // Write the updated controller
      fs.writeFileSync(controllerPath, controllerContent);

      // Generate exposed methods for the new resource
      console.log('Generating exposed methods for the new resource...');
      const resources = [{className: options.className, fileName}];
      const resourceSpecs = [{fileName, spec}];
      
      // Create a temporary generator to generate just the exposed methods for this resource
      const tempGenerator = new OpenAPIToConnector(spec, 'temp');
      const exposedMethods = tempGenerator.generateExposedResourceMethods(resources, resourceSpecs);
      
      // Add the exposed methods to the controller before the closing brace
      if (exposedMethods.trim()) {
        controllerContent = fs.readFileSync(controllerPath, 'utf-8');
        // Find the last method and add the new exposed methods
        const lastBrace = controllerContent.lastIndexOf('}');
        if (lastBrace !== -1) {
          const beforeBrace = controllerContent.substring(0, lastBrace);
          const afterBrace = controllerContent.substring(lastBrace);
          const updatedContent = `${beforeBrace}\n${exposedMethods}\n${afterBrace}`;
          fs.writeFileSync(controllerPath, updatedContent);
        }
      }

      console.log(`✅ Resource ${options.className} added successfully!`);
      console.log(`📄 Resource functions: ${resourcePath}`);
      console.log(`🎛️  Controller updated: ${controllerPath}`);
      console.log(`\n🎉 The new resource is fully integrated and ready to use!`);

      if (options.build !== false) {
        console.log('\n🔨 Building project...');
        await exec(`cd "${target}"; yarn build`);
        console.log('✅ Build complete!');
      }
    } catch (error) {
      console.error('❌ Error adding resource:', (error as Error).message);
      process.exit(1);
    }
  });

program.parse();
