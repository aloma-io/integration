// Reads a connector's controller source and produces the method declarations (`text`) and the method names
// (`methods`) that `cli build` writes to build/.controller.json.
//
// This used to go through @ts-ast-parser/core. That package has had no release since 2024 and its `engines` field
// stops at Node 20, so `yarn install` failed on Node 22 and 24. This file does the few things the SDK needs from it
// directly with the TypeScript compiler API (typescript is already a dependency) and `comment-parser` (the same
// JSDoc parser the old package used, so JSDoc tags come out the same).
import {parse as parseComment} from 'comment-parser';
import path from 'node:path';
import ts from 'typescript';

// ---------------------------------------------------------------------------------------------------------------
// program

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  experimentalDecorators: true,
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ES2020,
  lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
  declaration: true,
  skipLibCheck: true,
  skipDefaultLibCheck: true,
};

// the connector's tsconfig.json (found from the working directory upwards), else defaults
const compilerOptions = (): ts.CompilerOptions => {
  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');
  const config = configPath && ts.readConfigFile(configPath, ts.sys.readFile);
  if (!configPath || !config || config.error) return DEFAULT_COMPILER_OPTIONS;

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath), {}, configPath);
  return parsed.errors.length ? DEFAULT_COMPILER_OPTIONS : parsed.options;
};

const createProgram = (file: string) => {
  const options = compilerOptions();
  const program = ts.createProgram({rootNames: [file], options, host: ts.createCompilerHost(options, true)});

  const diagnostics = ts.sortAndDeduplicateDiagnostics([
    ...program.getSemanticDiagnostics(),
    ...program.getSyntacticDiagnostics(),
  ]);

  if (diagnostics.length) {
    const host: ts.FormatDiagnosticsHost = {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    };
    throw new Error(`${file} has TypeScript errors:\n${ts.formatDiagnostics(diagnostics, host)}`);
  }

  const source = program.getSourceFile(file);
  if (!source) throw new Error(`Unable to analyse file ${file}`);

  return {program, checker: program.getTypeChecker(), source};
};

// ---------------------------------------------------------------------------------------------------------------
// JSDoc: the tags of the comment in front of a node, as [{kind, value}] in first-appearance order of the kind

const trimNewLines = (str = '') => str.replace(/^\s+|\s+$/g, '');

const tagValue = (tagName: string, tag: any) => {
  const result: any = {};
  const description = trimNewLines(((d) => (d.startsWith('- ') ? d.slice(2) : d))(tag.description ?? ''));
  const name = tag.name ?? '';

  if ((tag.default ?? '') !== '') result.default = tag.default;
  if (tag.optional) result.optional = true;
  if ((tag.type ?? '') !== '') result.type = tag.type;
  if (name !== '') result.name = name;
  if (description !== '') result.description = description;

  const count = Object.keys(result).length;

  // only one string key: the value is that string
  if (count === 1 && (result.description ?? result.name)) return name || description;

  // name and description with no "-" between them: one string
  if (count === 2 && result.description && result.name) {
    const line = tag.source.find((s: any) => s.source.includes(tagName));
    const text = (line?.tokens.name ?? '') + (line?.tokens.description ?? '');
    if (!text.includes('-')) return [name, description].join(' ');
  }

  return result;
};

const jsDoc = (node: ts.Node) => {
  const text = node.getSourceFile()?.text;
  if (!text) return [];

  const comment = (ts.getLeadingCommentRanges(text, node.pos) ?? [])
    .map((range) => text.substring(range.pos, range.end))
    .join('\n');

  const byKind: Record<string, any[]> = {};
  const add = (kind: string, value: any) => (byKind[kind] ??= []).push(value);

  for (const block of parseComment(comment, {spacing: 'preserve'})) {
    if (block.problems.length) continue;

    const description = trimNewLines(block.description ?? '');
    if (description !== '') add('description', description);

    for (const tag of block.tags) add(tag.tag ?? '', tagValue(tag.tag ?? '', tag));
  }

  return Object.entries(byKind).flatMap(([kind, values]) => values.map((value) => ({kind, value})));
};

const isIgnored = (docs: {kind: string}[]) => docs.some(({kind}) => ['ignore', 'internal', 'private'].includes(kind));

// ---------------------------------------------------------------------------------------------------------------
// expressions and types

const isThirdParty = (path: string) => path.length < 1000 && (/.*node_modules\/.+/.test(path) || /^https?:\/\/.+/.test(path));

// the default value of a parameter or binding element, as text/number/boolean/null
const resolveExpression = (checker: ts.TypeChecker, expression: ts.Expression | undefined): any => {
  let expr: any = expression;
  if (expr == null) return undefined;

  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr) || ts.isParenthesizedExpression(expr) || ts.isComputedPropertyName(expr)) {
    expr = expr.expression;
  }

  if (ts.isPrefixUnaryExpression(expr)) {
    const value = resolveExpression(checker, expr.operand);
    if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') return value;
    if (expr.operator === ts.SyntaxKind.MinusToken) return -value;
    if (expr.operator === ts.SyntaxKind.ExclamationToken) return !value;
    if (expr.operator === ts.SyntaxKind.PlusToken) return +value;
    return value;
  }

  if (expr == null) return undefined;

  const text = expr.getText() ?? '';
  if (ts.isStringLiteralLike(expr) || ts.isArrayLiteralExpression(expr) || ts.isObjectLiteralExpression(expr)) return text;
  if (ts.isNumericLiteral(expr)) {
    const parsed = parseFloat(text);
    return isNaN(parsed) ? text : parsed;
  }
  if (expr.kind === ts.SyntaxKind.FalseKeyword || expr.kind === ts.SyntaxKind.TrueKeyword) return text === 'true';
  if (expr.kind === ts.SyntaxKind.NullKeyword) return null;
  if (expr.kind === ts.SyntaxKind.UndefinedKeyword) return undefined;

  if (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr)) {
    let symbol = checker.getSymbolAtLocation(expr);
    while (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);

    const declaration = (symbol ?? (expr as any).symbol)?.declarations?.[0];
    if (declaration == null || isThirdParty(declaration.getSourceFile().fileName)) return text;
    if (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration)) {
      return resolveExpression(checker, declaration.initializer);
    }
    return text;
  }

  return text;
};

const KEYWORD_TEXT: Record<number, string> = {
  [ts.SyntaxKind.NumberKeyword]: 'number',
  [ts.SyntaxKind.BooleanKeyword]: 'boolean',
  [ts.SyntaxKind.StringKeyword]: 'string',
  [ts.SyntaxKind.UndefinedKeyword]: 'undefined',
  [ts.SyntaxKind.NullKeyword]: 'null',
  [ts.SyntaxKind.ObjectKeyword]: 'object',
  [ts.SyntaxKind.SymbolKeyword]: 'symbol',
  [ts.SyntaxKind.BigIntKeyword]: 'bigint',
  [ts.SyntaxKind.VoidKeyword]: 'void',
};

const UNKNOWN_KEYWORD_TEXT: Record<number, string> = {
  [ts.SyntaxKind.AnyKeyword]: 'any',
  [ts.SyntaxKind.NeverKeyword]: 'never',
  [ts.SyntaxKind.ObjectKeyword]: 'object',
  [ts.SyntaxKind.UnknownKeyword]: 'unknown',
  [ts.SyntaxKind.IntrinsicKeyword]: 'intrinsic',
};

// the text of a type, given a type node (from source) or a type (turned into a node by the checker)
const typeText = (checker: ts.TypeChecker, nodeOrType: any): string => {
  let node: ts.TypeNode;
  let type: ts.Type;

  if ('kind' in nodeOrType) {
    node = nodeOrType;
    type = checker.getTypeFromTypeNode(nodeOrType);
  } else {
    type = nodeOrType;
    const made = checker.typeToTypeNode(type, undefined, ts.NodeBuilderFlags.IgnoreErrors);
    if (!made) return checker.typeToString(type);
    node = made;
  }

  // parentheses carry no information for the reader
  if (ts.isParenthesizedTypeNode(node)) {
    node = node.type;
    type = checker.getTypeFromTypeNode(node);
  }

  const nodeAtStart = node;
  const asString = () => checker.typeToString(type) ?? '';
  // a node written in the source has text; a node made by the checker does not
  const sourceText = () => {
    try {
      return nodeAtStart.getText() ?? '';
    } catch {
      return asString();
    }
  };
  const child = (n: ts.TypeNode) => typeText(checker, n);

  switch (node.kind) {
    case ts.SyntaxKind.TypeLiteral:
    case ts.SyntaxKind.ConditionalType:
    case ts.SyntaxKind.UnionType:
    case ts.SyntaxKind.IntersectionType:
    case ts.SyntaxKind.TypeOperator:
      return sourceText();
    case ts.SyntaxKind.ArrayType:
      return `${child((node as ts.ArrayTypeNode).elementType)}[]`;
    case ts.SyntaxKind.TupleType:
      return `[${(node as ts.TupleTypeNode).elements.map(child).join(', ')}]`;
    case ts.SyntaxKind.NamedTupleMember:
      return `${(node as ts.NamedTupleMember).name.getText() ?? ''}: ${child((node as ts.NamedTupleMember).type)}`;
    case ts.SyntaxKind.OptionalType:
      return `${child((node as ts.OptionalTypeNode).type)}?`;
    case ts.SyntaxKind.RestType:
      return `...${child((node as ts.RestTypeNode).type)}`;
    case ts.SyntaxKind.IndexedAccessType:
      return `${child((node as ts.IndexedAccessTypeNode).objectType)}[${child((node as ts.IndexedAccessTypeNode).indexType)}]`;
    case ts.SyntaxKind.TypeReference: {
      if ((type.flags & ts.TypeFlags.Any) === 0) return asString();
      const ref = node as ts.TypeReferenceNode;
      const name = ts.isIdentifier(ref.typeName) ? ref.typeName.text : ref.typeName.right.text;
      const args = (ref.typeArguments ?? []).map(child);
      return args.length > 0 ? `${name}<${args.join(', ')}>` : name;
    }
    case ts.SyntaxKind.LiteralType: {
      const literal: any = (node as ts.LiteralTypeNode).literal;
      switch (literal.kind) {
        case ts.SyntaxKind.TrueKeyword:
          return 'true';
        case ts.SyntaxKind.FalseKeyword:
          return 'false';
        case ts.SyntaxKind.NullKeyword:
          return 'null';
        case ts.SyntaxKind.PrefixUnaryExpression:
          if (literal.operand.kind === ts.SyntaxKind.NumericLiteral) return literal.getText();
          if (literal.operand.kind === ts.SyntaxKind.BigIntLiteral) return literal.getText().replace('n', '');
          return '';
        case ts.SyntaxKind.NumericLiteral:
        case ts.SyntaxKind.BigIntLiteral:
        case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
          return literal.text;
        case ts.SyntaxKind.StringLiteral:
          return `"${literal.text}"`;
        default:
          return '';
      }
    }
    case ts.SyntaxKind.InferType: {
      const parameter = (node as ts.InferTypeNode).typeParameter;
      return parameter.constraint ? `infer ${parameter.name.text} extends ${child(parameter.constraint)}` : `infer ${parameter.name.text}`;
    }
    case ts.SyntaxKind.TypePredicate: {
      const predicate = node as ts.TypePredicateNode;
      const name = ts.isThisTypeNode(predicate.parameterName) ? 'this' : predicate.parameterName.getText();
      const out = predicate.assertsModifier ? ['asserts', name] : [name];
      if (predicate.type) out.push('is', child(predicate.type));
      return out.join(' ');
    }
    case ts.SyntaxKind.FunctionType:
    case ts.SyntaxKind.TypeQuery:
    case ts.SyntaxKind.MappedType:
    case ts.SyntaxKind.TemplateLiteralType:
      return asString();
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.NeverKeyword:
    case ts.SyntaxKind.UnknownKeyword:
    case ts.SyntaxKind.IntrinsicKeyword:
      return UNKNOWN_KEYWORD_TEXT[node.kind];
    default:
      // intrinsic keywords (string, number, ...), else whatever the checker prints
      return KEYWORD_TEXT[node.kind] ?? asString();
  }
};

// type of a declaration with no checker symbol (the declared type, literals widened)
const typeOfDeclaration = (checker: ts.TypeChecker, node: ts.Node): ts.Type | ts.TypeNode => {
  const fromDoc = ts.getJSDocType(node);
  if (fromDoc) return fromDoc;
  const type = checker.getTypeAtLocation(node);
  const assertion =
    ts.hasOnlyExpressionInitializer(node) &&
    !!node.initializer &&
    (ts.isAsExpression(node.initializer) || ts.isTypeAssertionExpression(node));
  return assertion ? type : checker.getBaseTypeOfLiteralType(type);
};

// ---------------------------------------------------------------------------------------------------------------
// class and methods

const hasFlag = (flags: number, flag: number) => (flags & flag) === flag;

const isFunctionProperty = (decl: ts.Declaration) =>
  ts.isPropertyDeclaration(decl) && !!decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer));

const isPublic = (member: ts.Node) => {
  const flags = ts.getCombinedModifierFlags(member as ts.Declaration);
  const name: any = (member as any).name;
  return !(hasFlag(flags, ts.ModifierFlags.Private) || (name && ts.isPrivateIdentifier(name)) || hasFlag(flags, ts.ModifierFlags.Protected));
};

const modifierFlag = (node: ts.Node, flag: number) =>
  !!node && ts.canHaveModifiers(node) && !ts.isVariableStatement(node) && hasFlag(ts.getCombinedModifierFlags(node as ts.Declaration), flag);

// is the member declared in the class's base class
const isInherited = (checker: ts.TypeChecker, classNode: ts.Node, member: ts.Symbol) => {
  const base = checker.getTypeAtLocation(classNode).getBaseTypes?.()?.[0];
  if (!base) return false;

  const parents: ts.Node[] = (base.getSymbol()?.getDeclarations() ?? []).slice();
  parents.push(...parents.flatMap((parent) => (ts.isClassDeclaration(parent) ? parent.members.filter(ts.isConstructorDeclaration) : [])));

  return parents.some((parent) => member.getDeclarations()?.some((decl) => decl.parent === parent));
};

// the class declared by a statement: `class X {}` or `const X = class {}`
const classOf = (node: ts.Node): ts.ClassLikeDeclaration | null => {
  if (ts.isClassDeclaration(node)) return node;
  if (!ts.isVariableStatement(node)) return null;
  const initializer = node.declarationList.declarations[0]?.initializer;
  return initializer && ts.isClassExpression(initializer) ? initializer : null;
};

type Method = {
  name: string;
  decl: ts.Declaration;
  type: ts.Type;
};

// public instance methods the connector class declares itself (not inherited, not from node_modules)
const methodsOf = (checker: ts.TypeChecker, classNode: ts.ClassLikeDeclaration): Method[] => {
  const symbol = checker.getTypeAtLocation(classNode).getSymbol();
  const declared = symbol && checker.getDeclaredTypeOfSymbol(symbol);
  const methods: Method[] = [];

  for (const prop of declared?.getProperties() ?? []) {
    if (hasFlag(prop.flags, ts.SymbolFlags.ModuleMember) || hasFlag(prop.flags, ts.SymbolFlags.Prototype)) continue;

    const decl = prop.getDeclarations()?.[0];
    if (!decl) continue;
    if (isThirdParty(decl.getSourceFile()?.fileName ?? '')) continue;
    if (!ts.isMethodDeclaration(decl) && !isFunctionProperty(decl)) continue;

    const overrides = modifierFlag(decl, ts.ModifierFlags.Override);
    if (!overrides && isInherited(checker, classNode, prop)) continue;
    if (modifierFlag(decl, ts.ModifierFlags.Static) || !isPublic(decl)) continue;

    methods.push({
      name: (decl as any).name?.getText() ?? '',
      decl,
      type: checker.getTypeOfSymbolAtLocation(prop, classNode),
    });
  }

  return methods;
};

// the single class a connector file exports (`export default class ...`)
const exportedClass = (source: ts.SourceFile) => {
  // names exported by `export {A}`, `export {A as B}` and `export default A`
  const exportedNames = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) exportedNames.add(statement.expression.text);
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) exportedNames.add((element.propertyName ?? element.name).text);
    }
  }

  const declarations: {name: string; node: ts.Node}[] = [];
  const consider = (name: string, node: ts.Node, exportedHere: boolean) => {
    if (!exportedHere && !exportedNames.has(name)) return;
    if (isIgnored(jsDoc(node))) return;
    if (!declarations.some((d) => d.name === name)) declarations.push({name, node});
  };

  for (const statement of source.statements) {
    const exportedHere = ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) consider(declaration.name.getText(), statement, exportedHere);
    } else if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)
    ) {
      consider(statement.name?.getText() ?? 'default', statement, exportedHere);
    }
  }

  return declarations.length === 1 ? classOf(declarations[0].node) : null;
};

// ---------------------------------------------------------------------------------------------------------------
// declarations

function stripQuotes(name: string): string {
  if ((name.startsWith("'") && name.endsWith("'")) || (name.startsWith('"') && name.endsWith('"'))) {
    return name.slice(1, -1);
  }
  return name;
}

const symbolOf = (checker: ts.TypeChecker, node: any): ts.Symbol | null => {
  let symbol: ts.Symbol | undefined;
  try {
    symbol = checker.getSymbolAtLocation(node) ?? (node.name ? checker.getSymbolAtLocation(node.name) : undefined);
  } catch {
    symbol = undefined;
  }
  while (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
  return symbol ?? node.symbol ?? null;
};

// the properties of the object type of a destructured parameter: [name, type text]
//
// The type is turned into a type literal node and each property is read from that node, the way the previous
// implementation did, so the declarations stay identical (a property written as `email: string` in a
// `{email}: {email: string}` parameter is printed as `any`: a node the checker made cannot be resolved again).
const propertiesOf = (checker: ts.TypeChecker, parameter: ts.ParameterDeclaration, symbol: ts.Symbol | undefined): [string, string][] => {
  const type = symbol ? checker.getTypeOfSymbolAtLocation(symbol, parameter) : typeOfDeclaration(checker, parameter);

  let node: ts.TypeNode | undefined = 'kind' in type ? type : checker.typeToTypeNode(type, undefined, ts.NodeBuilderFlags.IgnoreErrors);
  if (node && ts.isParenthesizedTypeNode(node)) node = node.type;

  if (node && ts.isTypeLiteralNode(node)) {
    const literal = node;
    return literal.members.filter(ts.isPropertySignature).map((member) => {
      const name = ts.isIdentifier(member.name) ? String(member.name.escapedText) : member.name.getText();
      const memberSymbol = symbolOf(checker, member);
      const memberType = memberSymbol && checker.getTypeOfSymbolAtLocation(memberSymbol, literal);

      const fromDoc = ts.getJSDocType(member);
      if (fromDoc) return [name, typeText(checker, fromDoc)];
      if (memberType) return [name, typeText(checker, memberType)];
      if (member.type) return [name, typeText(checker, member.type)];
      return [name, typeText(checker, typeOfDeclaration(checker, member))];
    });
  }

  // not a type literal (an interface or a type alias, say): list its properties with the checker's types
  const realType = 'kind' in type ? checker.getTypeFromTypeNode(type) : type;
  return checker.getPropertiesOfType(realType).map((prop) => [prop.getName(), typeText(checker, checker.getTypeOfSymbolAtLocation(prop, parameter))]);
};

const declare = (checker: ts.TypeChecker, method: Method) => {
  const methodName = stripQuotes(method.name);

  return method.type
    .getNonNullableType()
    .getCallSignatures()
    .map((sig) => {
      const declaration: any = sig.getDeclaration();
      const docs = jsDoc(declaration);
      const desc = docs.find((what) => what.kind === 'description')?.value;
      const example = docs.find((what) => what.kind === 'example')?.value;
      const ns = docs.find((what) => what.kind === 'namespace')?.value;
      const space = ns ? `@namespace ${ns}` : '';

      let eg;
      if (example) {
        const parts = example.split(/```/);
        const backticks = '```';
        eg = `@example ${parts[0] || 'usage'}\n${backticks}${parts[1]}${backticks}`;
      }

      const paramDocs = docs.filter((what) => what.kind === 'param');

      // only destructured parameters ({a, b}: {...}) are part of the declaration
      const params = (declaration.parameters as ts.ParameterDeclaration[])
        .map((parameter, index) => ({parameter, symbol: sig.parameters[index]}))
        .filter(({parameter}) => !isIgnored(jsDoc(parameter)) && ts.isObjectBindingPattern(parameter.name))
        .map(({parameter, symbol}) => {
          const prefix = (parameter.name as ts.ObjectBindingPattern).elements
            .map((p) => {
              const defaultVal = resolveExpression(checker, p.initializer);
              return `${p.name.getText()}${defaultVal != null ? ' = ' + defaultVal : ''}`;
            })
            .join('; ');

          const suffix = propertiesOf(checker, parameter, symbol)
            .map(([name, type]) => {
              const comment = paramDocs.find((what) => what.value.name === name);
              const description = (comment?.value.description || '').replace(/\\@/gi, '@');

              return `\n/**\n${description}\n */\n ${name}: ${type}`;
            })
            .join('; ');

          return `{${prefix}}: {${suffix}}`;
        })
        .join(', ');

      const fromDoc = ts.getJSDocReturnType(declaration);
      const retVal = typeText(checker, fromDoc ?? checker.getReturnTypeOfSignature(sig)).replace(/^Promise</, '').replace(/>$/, '');

      // the exact whitespace (including the spaces after "**/") is part of the output other tools read
      return [
        '',
        '/**',
        ` * ${desc || ''}`,
        ' *',
        ` * ${space || ''}`,
        ` * ${eg || ''}`,
        ' **/    ',
        `declare function ${methodName}(${params}): ${retVal};`,
        '      ',
      ].join('\n');
    })
    .join('\n');
};

export default async (file: string) => {
  const {checker, source} = createProgram(file);

  const classNode = exportedClass(source);
  if (!classNode) throw new Error('connector file needs to export default class');

  const methods = methodsOf(checker, classNode).filter((method) => !stripQuotes(method.name).startsWith('_'));

  return {
    text: methods.map((method) => declare(checker, method)).join(''),
    methods: [...new Set(methods.map((method) => stripQuotes(method.name)))],
  };
};
