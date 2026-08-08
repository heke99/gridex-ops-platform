'use strict';

const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const sourcePath = path.join(root, 'lib/website/customerApplications.ts');
const outDir = path.dirname(sourcePath);
const text = fs.readFileSync(sourcePath, 'utf8');
const sf = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const compilerOpts = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noResolve: true,
};
const host = ts.createCompilerHost(compilerOpts);
host.getSourceFile = (name) => (name === sourcePath ? sf : undefined);
host.fileExists = (name) => name === sourcePath;
host.readFile = (name) => (name === sourcePath ? text : undefined);
const checker = ts.createProgram([sourcePath], compilerOpts, host).getTypeChecker();

const groups = [
  { key: 'schemas', start: 91, end: 1307, file: 'customerApplicationSchemas.ts' },
  { key: 'legal', start: 1309, end: 2856, file: 'customerApplicationLegal.ts' },
  { key: 'core', start: 2858, end: 4570, file: 'customerApplicationCore.ts' },
  { key: 'communication', start: 4572, end: 5528, file: 'customerApplicationCommunication.ts' },
  { key: 'persistence', start: 5530, end: 6576, file: 'customerApplicationPersistence.ts' },
  { key: 'onboarding', start: 6579, end: 7159, file: 'customerApplicationOnboarding.ts' },
  { key: 'process', start: 7161, end: 8822, file: 'customerApplicationProcess.ts' },
  { key: 'repair', start: 8824, end: 9808, file: 'customerApplicationRepair.ts' },
];
const byKey = Object.fromEntries(groups.map((group) => [group.key, group]));

function lineAt(pos) {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function groupFor(statement) {
  const line = lineAt(statement.getStart(sf));
  return groups.find((group) => line >= group.start && line <= group.end);
}

function namesOf(statement) {
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    statement.name
  ) {
    return [statement.name.text];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations
      .filter((declaration) => ts.isIdentifier(declaration.name))
      .map((declaration) => declaration.name.text);
  }
  return [];
}

function isTypeDeclaration(statement) {
  return ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement);
}

const topLevel = new Map();
for (const statement of sf.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  const group = groupFor(statement);
  if (!group) continue;
  for (const name of namesOf(statement)) {
    topLevel.set(name, {
      statement,
      group,
      typeOnly: isTypeDeclaration(statement),
    });
  }
}

const importLocals = new Map();
const importDeclarations = [];
for (const statement of sf.statements) {
  if (!ts.isImportDeclaration(statement)) continue;
  importDeclarations.push(statement);
  const clause = statement.importClause;
  if (!clause) continue;
  if (clause.name) importLocals.set(clause.name.text, { statement, node: clause.name });
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) {
    importLocals.set(bindings.name.text, { statement, node: bindings });
  }
  if (bindings && ts.isNamedImports(bindings)) {
    for (const specifier of bindings.elements) {
      importLocals.set(specifier.name.text, { statement, node: specifier });
    }
  }
}

const usage = Object.fromEntries(
  groups.map((group) => [group.key, { internal: new Set(), external: new Set() }]),
);

function visit(node, group) {
  if (ts.isIdentifier(node)) {
    const isDeclarationName =
      node.parent &&
      (ts.isFunctionDeclaration(node.parent) ||
        ts.isTypeAliasDeclaration(node.parent) ||
        ts.isInterfaceDeclaration(node.parent) ||
        ts.isClassDeclaration(node.parent) ||
        ts.isVariableDeclaration(node.parent) ||
        ts.isParameter(node.parent)) &&
      node.parent.name === node;
    if (!isDeclarationName) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol) {
        const name = node.text;
        const internal = topLevel.get(name);
        if (internal && internal.group.key !== group.key) {
          usage[group.key].internal.add(name);
        }
        if (importLocals.has(name)) {
          usage[group.key].external.add(name);
        }
      }
    }
  }
  ts.forEachChild(node, (child) => visit(child, group));
}

for (const statement of sf.statements) {
  if (ts.isImportDeclaration(statement)) continue;
  const group = groupFor(statement);
  if (group) visit(statement, group);
}

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

function filteredExternalImports(group) {
  const needed = usage[group.key].external;
  const lines = [];
  for (const statement of importDeclarations) {
    const clause = statement.importClause;
    if (!clause) continue;
    const defaultName = clause.name && needed.has(clause.name.text) ? clause.name : undefined;
    let bindings;
    const originalBindings = clause.namedBindings;
    if (originalBindings && ts.isNamespaceImport(originalBindings)) {
      if (needed.has(originalBindings.name.text)) bindings = originalBindings;
    } else if (originalBindings && ts.isNamedImports(originalBindings)) {
      const elements = originalBindings.elements.filter((specifier) => needed.has(specifier.name.text));
      if (elements.length) bindings = ts.factory.updateNamedImports(originalBindings, elements);
    }
    if (!defaultName && !bindings) continue;
    const updatedClause = ts.factory.updateImportClause(
      clause,
      clause.isTypeOnly,
      defaultName,
      bindings,
    );
    const updated = ts.factory.updateImportDeclaration(
      statement,
      statement.modifiers,
      updatedClause,
      statement.moduleSpecifier,
      statement.attributes,
    );
    lines.push(printer.printNode(ts.EmitHint.Unspecified, updated, sf));
  }
  return lines;
}

function internalImports(group) {
  const byModule = {};
  for (const name of usage[group.key].internal) {
    const declaration = topLevel.get(name);
    if (!declaration) continue;
    const key = declaration.group.key;
    if (!byModule[key]) byModule[key] = { type: [], value: [] };
    byModule[key][declaration.typeOnly ? 'type' : 'value'].push(name);
  }
  const lines = [];
  for (const [key, sets] of Object.entries(byModule).sort()) {
    const modulePath = `./${byKey[key].file.replace(/\.ts$/, '')}`;
    if (sets.value.length) {
      lines.push(`import { ${sets.value.sort().join(', ')} } from "${modulePath}";`);
    }
    if (sets.type.length) {
      lines.push(`import type { ${sets.type.sort().join(', ')} } from "${modulePath}";`);
    }
  }
  return lines;
}

function hasExport(statement) {
  return Boolean(statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function exportedRaw(statement) {
  let raw = text.slice(statement.getFullStart(), statement.end);
  if (!hasExport(statement)) {
    const offset = statement.getStart(sf) - statement.getFullStart();
    raw = `${raw.slice(0, offset)}export ${raw.slice(offset)}`;
  }
  return raw;
}

for (const group of groups) {
  const imports = [...filteredExternalImports(group), ...internalImports(group)];
  const statements = sf.statements.filter(
    (statement) => !ts.isImportDeclaration(statement) && groupFor(statement)?.key === group.key,
  );
  const body = statements.map(exportedRaw).join('');
  const content =
    '// Internal module extracted from customerApplications.ts to keep handwritten production files bounded.\n' +
    imports.join('\n') +
    '\n' +
    body.replace(/^\s+/, '\n');
  fs.writeFileSync(path.join(outDir, group.file), content);
}

const facade = [
  'export { processWebsiteCustomerApplication } from "./customerApplicationProcess";',
  'export { continueWebsiteCustomerApplication, repairWebsiteCustomerApplication } from "./customerApplicationRepair";',
  'export type { RepairWebsiteCustomerApplicationResult, WebsiteCustomerApplicationContinuationOutcome } from "./customerApplicationRepair";',
  '',
].join('\n');
fs.writeFileSync(sourcePath, facade);

const files = [sourcePath, ...groups.map((group) => path.join(outDir, group.file))];
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').length - 1;
  if (lines > 2500) {
    throw new Error(`${path.relative(root, file)} has ${lines} lines; expected <= 2500`);
  }
  console.log(`${path.relative(root, file)}: ${lines} lines`);
}
