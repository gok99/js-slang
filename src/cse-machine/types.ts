import type es from 'estree'

import type { Environment, Node } from '../types'
import type Closure from './closure'

export enum InstrType {
  RESET = 'Reset',
  WHILE = 'While',
  FOR = 'For',
  ASSIGNMENT = 'Assignment',
  UNARY_OP = 'UnaryOperation',
  BINARY_OP = 'BinaryOperation',
  POP = 'Pop',
  APPLICATION = 'Application',
  BRANCH = 'Branch',
  ENVIRONMENT = 'Environment',
  ARRAY_LITERAL = 'ArrayLiteral',
  OBJECT_LITERAL = 'ObjectLiteral',
  ARRAY_ACCESS = 'ArrayAccess',
  ARRAY_ASSIGNMENT = 'ArrayAssignment',
  ARRAY_LENGTH = 'ArrayLength',
  MARKER = 'Marker',
  CONTINUE = 'Continue',
  CONTINUE_MARKER = 'ContinueMarker',
  BREAK = 'Break',
  BREAK_MARKER = 'BreakMarker',
  SPREAD = 'Spread',
  // Delimited continuation instructions
  RESET_CONTROL_MARKER = 'ResetControlMarker',
  ENV_STACK_RESTORE = 'EnvStackRestore',
  // Effect handler instructions
  HANDLER_CONTROL_MARKER = 'HandlerControlMarker',
  RUN_WITH_HANDLER = 'RunWithHandler',
  PERFORM = 'Perform'
}

interface BaseInstr<T extends InstrType = InstrType, U extends Node = Node> {
  instrType: T
  srcNode: U
  isEnvDependent?: boolean
}

export interface WhileInstr extends BaseInstr<InstrType.WHILE> {
  test: es.Expression
  body: es.Statement
}

export interface ForInstr extends BaseInstr<InstrType.FOR> {
  init: es.VariableDeclaration | es.Expression
  test: es.Expression
  update: es.Expression
  body: es.Statement
}

export interface DeclAssmtInstr extends BaseInstr<InstrType.ASSIGNMENT, es.VariableDeclaration> {
  symbol: string
  constant: boolean
  declaration: true
}

export interface RegularAssmtInstr extends BaseInstr<
  InstrType.ASSIGNMENT,
  es.AssignmentExpression
> {
  declaration: false
  symbol: string
}

export type AssmtInstr = DeclAssmtInstr | RegularAssmtInstr

export interface UnOpInstr extends BaseInstr<InstrType.UNARY_OP, es.UnaryExpression> {
  symbol: es.UnaryOperator
}

export interface BinOpInstr extends BaseInstr<InstrType.BINARY_OP> {
  symbol: es.BinaryOperator
}

export interface AppInstr extends BaseInstr<InstrType.APPLICATION, es.CallExpression> {
  numOfArgs: number
}

export interface BranchInstr extends BaseInstr<InstrType.BRANCH> {
  consequent: es.Expression | es.Statement
  alternate: es.Expression | es.Statement | null | undefined
}

export interface EnvInstr extends BaseInstr<InstrType.ENVIRONMENT> {
  env: Environment
}

export interface ArrLitInstr extends BaseInstr<InstrType.ARRAY_LITERAL> {
  arity: number
}

export interface ObjLitInstr extends BaseInstr<InstrType.OBJECT_LITERAL> {
  keys: string[]
}

// Delimited continuation marker instruction
export interface ResetControlMarkerInstr extends BaseInstr {
  instrType: InstrType.RESET_CONTROL_MARKER
}

// Environment stack restore instruction for delimited continuation
export interface EnvStackRestoreInstr extends BaseInstr {
  instrType: InstrType.ENV_STACK_RESTORE
  envStack: Environment[]
}

// Effect handler instructions
export interface HandlerControlMarkerInstr extends BaseInstr {
  instrType: InstrType.HANDLER_CONTROL_MARKER
  handler: Handler
  id: string
}

export interface RunWithHandlerInstr extends BaseInstr {
  instrType: InstrType.RUN_WITH_HANDLER
  body: es.BlockStatement
}

export interface PerformInstr extends BaseInstr {
  instrType: InstrType.PERFORM
  op: string
  arity: number
}

// Handler type - maps operation names to handler functions
export type Handler = Map<string, any>

// Special marker values for the stash
export class ResetStashMarker {
  public toString(): string {
    return 'reset_stash_marker'
  }
}

export class HandlerStashMarker {
  constructor(public readonly id: string) {}
  public toString(): string {
    return `handler_stash_marker(${this.id})`
  }
}

export type Instr =
  | AppInstr
  | ArrLitInstr
  | ObjLitInstr
  | AssmtInstr
  | BaseInstr
  | BinOpInstr
  | BranchInstr
  | EnvInstr
  | ForInstr
  | UnOpInstr
  | WhileInstr
  | ResetControlMarkerInstr
  | EnvStackRestoreInstr
  | HandlerControlMarkerInstr
  | RunWithHandlerInstr
  | PerformInstr

export type InstrTypeToInstr<T extends InstrType> =
  Extract<Instr, { instrType: T }> extends never ? BaseInstr : Extract<Instr, { instrType: T }>

export type ControlItem = (Node | Instr) & {
  isEnvDependent?: boolean
}

// Every array also has the properties `id` and `environment` for use in the frontend CSE Machine
export type EnvArray = any[] & {
  readonly id: string
  environment: Environment
}

// Objects in the heap can only store arrays or closures
export type HeapObject = EnvArray | Closure

// Special class that cannot be found on the stash so is safe to be used
// as an indicator of a breakpoint from running the CSE machine
export class CSEBreak {}

// Special value that cannot be found on the stash so is safe to be used
// as an indicator of an error from running the CSE machine
export class CseError {
  constructor(public readonly error: any) {}
}
