export const libraryParserLanguage = 100
// S4S (DELIM_CONT) is chapter -16, use -Infinity to always allow basic constructs
export const alwaysAllowed = -Infinity

const syntaxBlacklist: { [nodeName: string]: number } = {
  // List of all node types taken from
  // https://github.com/acornjs/acorn/blob/master/acorn-walk/src/index.js

  // Chapter 1 - always allowed for S4S (DELIM_CONT chapter is -16)
  Program: alwaysAllowed,
  BlockStatement: alwaysAllowed,
  ExpressionStatement: alwaysAllowed,
  IfStatement: alwaysAllowed,
  ReturnStatement: alwaysAllowed,
  FunctionDeclaration: alwaysAllowed,
  VariableDeclaration: alwaysAllowed,
  VariableDeclarator: alwaysAllowed,
  ArrowFunctionExpression: alwaysAllowed,
  UnaryExpression: alwaysAllowed,
  BinaryExpression: alwaysAllowed,
  LogicalExpression: alwaysAllowed,
  ConditionalExpression: alwaysAllowed,
  CallExpression: alwaysAllowed,
  Identifier: alwaysAllowed,
  Literal: alwaysAllowed,
  TemplateLiteral: alwaysAllowed,
  TemplateElement: alwaysAllowed,
  DebuggerStatement: alwaysAllowed,
  ImportDeclaration: alwaysAllowed,
  ImportSpecifier: alwaysAllowed,

  // Chapter 2 - always allowed for S4S
  ExportNamedDeclaration: alwaysAllowed,

  // Chapter 3 - always allowed for S4S
  BreakStatement: alwaysAllowed,
  ContinueStatement: alwaysAllowed,
  WhileStatement: alwaysAllowed,
  ForStatement: alwaysAllowed,
  MemberPattern: alwaysAllowed,
  ArrayExpression: alwaysAllowed,
  AssignmentExpression: alwaysAllowed,
  MemberExpression: alwaysAllowed,
  Property: alwaysAllowed,
  SpreadElement: alwaysAllowed,
  RestElement: alwaysAllowed,

  // ObjectExpression needed for effect handlers in S4S - always allowed
  ObjectExpression: alwaysAllowed,
  NewExpression: libraryParserLanguage,
  TryStatement: libraryParserLanguage,
  CatchClause: libraryParserLanguage,
  ThrowStatement: libraryParserLanguage,
  ThisExpression: libraryParserLanguage,
  Super: libraryParserLanguage,
  ClassDeclaration: libraryParserLanguage,
  ClassExpression: libraryParserLanguage,
  Class: libraryParserLanguage,
  ClassBody: libraryParserLanguage,
  MethodDefinition: libraryParserLanguage,
  FunctionExpression: libraryParserLanguage,
  ImportDefaultSpecifier: libraryParserLanguage,
  ExportDefaultDeclaration: libraryParserLanguage,
  ExportAllDeclaration: libraryParserLanguage,
  ImportNamespaceSpecifier: libraryParserLanguage,

  // Disallowed forever
  UpdateExpression: Infinity,
  Statement: Infinity,
  EmptyStatement: Infinity,
  ParenthesizedExpression: Infinity,
  LabeledStatement: Infinity,
  WithStatement: Infinity,
  SwitchStatement: Infinity,
  SwitchCase: Infinity,
  YieldExpression: Infinity,
  AwaitExpression: Infinity,
  DoWhileStatement: Infinity,
  ForInStatement: Infinity,
  ForOfStatement: Infinity,
  ForInit: Infinity,
  Function: Infinity,
  Pattern: Infinity,
  VariablePattern: Infinity,
  ArrayPattern: Infinity,
  ObjectPattern: Infinity,
  Expression: Infinity,
  MetaProperty: Infinity,
  SequenceExpression: Infinity,
  AssignmentPattern: Infinity,
  TaggedTemplateExpression: Infinity
}

export default syntaxBlacklist
