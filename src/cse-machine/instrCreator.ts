/**
 * Utility functions for creating the various control instructions.
 */

import type es from 'estree'

import type { Environment, Node } from '../types'
import {
  type AppInstr,
  type ArrLitInstr,
  type AssmtInstr,
  type BinOpInstr,
  type BranchInstr,
  type DeclAssmtInstr,
  type EnvInstr,
  type EnvStackRestoreInstr,
  type ForInstr,
  type Handler,
  type HandlerControlMarkerInstr,
  type Instr,
  InstrType,
  type ObjLitInstr,
  type PerformInstr,
  type RegularAssmtInstr,
  type ResetControlMarkerInstr,
  type RunWithHandlerInstr,
  type UnOpInstr,
  type WhileInstr
} from './types'

export const resetInstr = (srcNode: Node): Instr => ({
  instrType: InstrType.RESET,
  srcNode
})

export const whileInstr = (test: es.Expression, body: es.Statement, srcNode: Node): WhileInstr => ({
  instrType: InstrType.WHILE,
  test,
  body,
  srcNode
})

export const forInstr = (
  init: es.VariableDeclaration | es.Expression,
  test: es.Expression,
  update: es.Expression,
  body: es.Statement,
  srcNode: es.ForStatement
): ForInstr => ({
  instrType: InstrType.FOR,
  init,
  test,
  update,
  body,
  srcNode
})

export function assmtInstr(symbol: string, srcNode: es.VariableDeclaration): DeclAssmtInstr
export function assmtInstr(symbol: string, srcNode: es.AssignmentExpression): RegularAssmtInstr
export function assmtInstr(
  symbol: string,
  srcNode: es.VariableDeclaration | es.AssignmentExpression
): AssmtInstr {
  if (srcNode.type === 'VariableDeclaration') {
    return {
      instrType: InstrType.ASSIGNMENT,
      symbol,
      constant: srcNode.kind === 'const',
      declaration: true,
      srcNode
    }
  }

  return {
    instrType: InstrType.ASSIGNMENT,
    symbol,
    declaration: false,
    srcNode
  }
}

export const unOpInstr = (symbol: es.UnaryOperator, srcNode: es.UnaryExpression): UnOpInstr => ({
  instrType: InstrType.UNARY_OP,
  symbol,
  srcNode
})

export const binOpInstr = (symbol: es.BinaryOperator, srcNode: Node): BinOpInstr => ({
  instrType: InstrType.BINARY_OP,
  symbol,
  srcNode
})

export const popInstr = (srcNode: Node): Instr => ({ instrType: InstrType.POP, srcNode })

export const appInstr = (numOfArgs: number, srcNode: es.CallExpression): AppInstr => ({
  instrType: InstrType.APPLICATION,
  numOfArgs,
  srcNode
})

export const branchInstr = (
  consequent: es.Expression | es.Statement,
  alternate: es.Expression | es.Statement | null | undefined,
  srcNode: Node
): BranchInstr => ({
  instrType: InstrType.BRANCH,
  consequent,
  alternate,
  srcNode
})

export const envInstr = (env: Environment, srcNode: Node): EnvInstr => ({
  instrType: InstrType.ENVIRONMENT,
  env,
  srcNode
})

export const arrLitInstr = (arity: number, srcNode: Node): ArrLitInstr => ({
  instrType: InstrType.ARRAY_LITERAL,
  arity,
  srcNode
})

export const objLitInstr = (keys: string[], srcNode: Node): ObjLitInstr => ({
  instrType: InstrType.OBJECT_LITERAL,
  keys,
  srcNode
})

export const arrAccInstr = (srcNode: Node): Instr => ({
  instrType: InstrType.ARRAY_ACCESS,
  srcNode
})

export const arrAssmtInstr = (srcNode: Node): Instr => ({
  instrType: InstrType.ARRAY_ASSIGNMENT,
  srcNode
})

export const markerInstr = (srcNode: Node): Instr => ({
  instrType: InstrType.MARKER,
  srcNode
})

export const contInstr = (srcNode: Node): Instr => ({
  instrType: InstrType.CONTINUE,
  srcNode
})

export const contMarkerInstr = (srcNode: Node): Instr => ({
  instrType: InstrType.CONTINUE_MARKER,
  srcNode
})

export const breakInstr = (srcNode: Node): Instr => ({
  instrType: InstrType.BREAK,
  srcNode
})

export const breakMarkerInstr = (srcNode: Node): Instr => ({
  instrType: InstrType.BREAK_MARKER,
  srcNode
})

export const spreadInstr = (srcNode: Node): Instr => ({
  instrType: InstrType.SPREAD,
  srcNode
})

// Delimited continuation instruction creators
export const resetControlMarkerInstr = (srcNode: Node): ResetControlMarkerInstr => ({
  instrType: InstrType.RESET_CONTROL_MARKER,
  srcNode
})

// Effect handler instruction creators
export const handlerControlMarkerInstr = (
  handler: Handler,
  id: number,
  srcNode: Node
): HandlerControlMarkerInstr => ({
  instrType: InstrType.HANDLER_CONTROL_MARKER,
  handler,
  id,
  srcNode
})

export const runWithHandlerInstr = (
  body: es.BlockStatement,
  srcNode: Node
): RunWithHandlerInstr => ({
  instrType: InstrType.RUN_WITH_HANDLER,
  body,
  srcNode
})

export const performInstr = (op: string, arity: number, srcNode: Node): PerformInstr => ({
  instrType: InstrType.PERFORM,
  op,
  arity,
  srcNode
})

export const envStackRestoreInstr = (
  envStack: Environment[],
  srcNode: Node
): EnvStackRestoreInstr => ({
  instrType: InstrType.ENV_STACK_RESTORE,
  envStack,
  srcNode
})
