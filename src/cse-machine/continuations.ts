import * as es from 'estree'

import { Context, Environment } from '../types'
import { Control, Stash, Transformers } from './interpreter'
import { ControlItem, Handler } from './types'
import { uniqueId } from './utils'

/**
 * A dummy function used to detect for the apply function object.
 * If the interpreter sees this specific function, it applies the function
 * with the given arguments to apply.
 *
 * We need this to be a metaprocedure so that it can properly handle
 * the arguments passed to it, even if they are continuations.
 */
export class Apply extends Function {
  private static instance: Apply = new Apply()

  private constructor() {
    super()
  }

  public static get(): Apply {
    return Apply.instance
  }

  public toString(): string {
    return 'apply'
  }
}

export const apply = Apply.get()

export function isApply(value: any): boolean {
  return value === apply
}

/**
 * A dummy function used to detect for the call/cc function object.
 * If the interpreter sees this specific function, a continuation at the current
 * point of evaluation is executed instead of a regular function call.
 */
export class Call_cc extends Function {
  private static instance: Call_cc = new Call_cc()

  private constructor() {
    super()
  }

  public static get(): Call_cc {
    return Call_cc.instance
  }

  public toString(): string {
    return 'call/cc'
  }
}

export const call_with_current_continuation = Call_cc.get()

export function isCallWithCurrentContinuation(value: any): boolean {
  return value === call_with_current_continuation
}

/**
 * An object representing a continuation of the CSE machine.
 * When instantiated, it copies the control stack, and
 * current environment at the point of capture.
 *
 * Continuations and functions are treated as the same by
 * the typechecker so that they can be first-class values.
 */
export class Continuation extends Function {
  private control: Control
  private stash: Stash
  private env: Environment[]
  private transformers: Transformers

  /** Unique ID defined for continuation */
  public readonly id: string

  constructor(
    context: Context,
    control: Control,
    stash: Stash,
    env: Environment[],
    transformers: Transformers
  ) {
    super()
    this.control = control.copy()
    this.stash = stash.copy()
    this.env = [...env]
    this.transformers = transformers
    this.id = uniqueId(context)
  }

  // As the continuation needs to be immutable (we can call it several times)
  // we need to copy its elements whenever we access them
  public getControl(): Control {
    return this.control.copy()
  }

  public getStash(): Stash {
    return this.stash.copy()
  }

  public getEnv(): Environment[] {
    return [...this.env]
  }

  public getTransformers(): Transformers {
    return this.transformers
  }

  public toString(): string {
    return 'continuation'
  }

  public equals(other: Continuation): boolean {
    return this === other
  }
}

/**
 * Provides an adequate representation of what calling
 * call/cc or continuations looks like, to give to the
 * APPLICATION instruction.
 */
export function makeDummyContCallExpression(callee: string, argument: string): es.CallExpression {
  return {
    type: 'CallExpression',
    optional: false,
    callee: {
      type: 'Identifier',
      name: callee
    },
    arguments: [
      {
        type: 'Identifier',
        name: argument
      }
    ]
  }
}

/**
 * A dummy function used to detect for the shift function object.
 * If the interpreter sees this specific function, a delimited continuation
 * up to the nearest reset marker is captured.
 */
export class Shift extends Function {
  private static instance: Shift = new Shift()

  private constructor() {
    super()
  }

  public static get(): Shift {
    return Shift.instance
  }

  public toString(): string {
    return 'shift'
  }
}

export const shift = Shift.get()

export function isShift(value: any): boolean {
  return value === shift
}

/**
 * A dummy function used to detect for the reset function object.
 * If the interpreter sees this specific function, it places delimiter
 * markers on the control and stash.
 */
export class Reset extends Function {
  private static instance: Reset = new Reset()

  private constructor() {
    super()
  }

  public static get(): Reset {
    return Reset.instance
  }

  public toString(): string {
    return 'reset'
  }
}

export const reset = Reset.get()

export function isReset(value: any): boolean {
  return value === reset
}

/**
 * A delimited continuation object that captures a portion of the
 * control stack, stash, and environment up to a delimiter marker.
 *
 * Unlike full continuations (from call/cc), delimited continuations:
 * - Only capture up to the nearest reset/handler marker
 * - When applied, append to the current state rather than replacing it
 * - Can be invoked multiple times (multi-shot)
 */
export class DelimitedContinuation extends Function {
  /** Captured control items up to the delimiter */
  private control: ControlItem[]
  /** Captured stash values up to the delimiter */
  private stash: any[]
  /** Environment stack at the point of capture (full call stack, not just lexical chain) */
  private envStack: Environment[]
  /** Transformers at the point of capture */
  private transformers: Transformers

  /** Unique ID for this continuation */
  public readonly id: string

  /** Optional handler for effect handler continuations */
  public readonly handler?: Handler
  public readonly handlerId?: number

  constructor(
    context: Context,
    control: ControlItem[],
    stash: any[],
    envStack: Environment[],
    transformers: Transformers,
    handler?: Handler,
    handlerId?: number
  ) {
    super()
    // Store copies of the captured state
    this.control = [...control]
    this.stash = [...stash]
    this.envStack = [...envStack]
    this.transformers = transformers
    this.id = uniqueId(context)
    this.handler = handler
    this.handlerId = handlerId
  }

  public getControl(): ControlItem[] {
    return [...this.control]
  }

  public getStash(): any[] {
    return [...this.stash]
  }

  public getEnvStack(): Environment[] {
    return [...this.envStack]
  }

  public getTransformers(): Transformers {
    return this.transformers
  }

  public toString(): string {
    return 'delimited_continuation'
  }

  public equals(other: DelimitedContinuation): boolean {
    return this === other
  }
}

/**
 * A dummy function used to detect for the withHandle function object.
 * If the interpreter sees this specific function, it places handler
 * markers on the control and stash and executes the body.
 */
export class WithHandle extends Function {
  private static instance: WithHandle = new WithHandle()

  private constructor() {
    super()
  }

  public static get(): WithHandle {
    return WithHandle.instance
  }

  public toString(): string {
    return 'withHandle'
  }
}

export const withHandle = WithHandle.get()

export function isWithHandle(value: any): boolean {
  return value === withHandle
}

/**
 * A dummy function used to detect for the perform function object.
 * If the interpreter sees this specific function, it captures a delimited
 * continuation up to the nearest handler that handles the operation.
 */
export class Perform extends Function {
  private static instance: Perform = new Perform()

  private constructor() {
    super()
  }

  public static get(): Perform {
    return Perform.instance
  }

  public toString(): string {
    return 'perform'
  }
}

export const perform = Perform.get()

export function isPerform(value: any): boolean {
  return value === perform
}
