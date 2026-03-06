import * as es from 'estree'

import { Environment, Node } from '../types'
import Closure from './closure'
import { SchemeControlItems } from './scheme-macros'
import { Transformers } from './interpreter'

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

interface BaseInstr {
  instrType: InstrType
  srcNode: Node
  isEnvDependent?: boolean
}

export interface WhileInstr extends BaseInstr {
  test: es.Expression
  body: es.Statement
}

export interface ForInstr extends BaseInstr {
  init: es.VariableDeclaration | es.Expression
  test: es.Expression
  update: es.Expression
  body: es.Statement
}

export interface AssmtInstr extends BaseInstr {
  symbol: string
  constant: boolean
  declaration: boolean
}

export interface UnOpInstr extends BaseInstr {
  symbol: es.UnaryOperator
}

export interface BinOpInstr extends BaseInstr {
  symbol: es.BinaryOperator
}

export interface AppInstr extends BaseInstr {
  numOfArgs: number
  srcNode: es.CallExpression
}

export interface BranchInstr extends BaseInstr {
  consequent: es.Expression | es.Statement
  alternate: es.Expression | es.Statement | null | undefined
}

export interface EnvInstr extends BaseInstr {
  env: Environment
  transformers: Transformers
}

export interface ArrLitInstr extends BaseInstr {
  arity: number
}

export interface ObjLitInstr extends BaseInstr {
  keys: string[]
}

export interface SpreadInstr extends BaseInstr {
  symbol: es.SpreadElement
}

// Delimited continuation marker instruction
export interface ResetControlMarkerInstr extends BaseInstr {
  instrType: InstrType.RESET_CONTROL_MARKER
}

// Environment stack restore instruction for delimited continuation
export interface EnvStackRestoreInstr extends BaseInstr {
  instrType: InstrType.ENV_STACK_RESTORE
  envStack: Environment[]
  transformers: Transformers
}

// Effect handler instructions
export interface HandlerControlMarkerInstr extends BaseInstr {
  instrType: InstrType.HANDLER_CONTROL_MARKER
  handler: Handler
  id: number
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
  constructor(public readonly id: number) {}
  public toString(): string {
    return `handler_stash_marker(${this.id})`
  }
}

export type Instr =
  | BaseInstr
  | WhileInstr
  | AssmtInstr
  | AppInstr
  | BranchInstr
  | EnvInstr
  | ArrLitInstr
  | ObjLitInstr
  | SpreadInstr
  | ResetControlMarkerInstr
  | EnvStackRestoreInstr
  | HandlerControlMarkerInstr
  | RunWithHandlerInstr
  | PerformInstr

export type ControlItem = (Node | Instr | SchemeControlItems) & {
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
