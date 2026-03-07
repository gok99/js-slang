/**
 * This interpreter implements an explicit-control evaluator.
 *
 * Heavily adapted from https://github.com/source-academy/JSpike/
 * and the legacy interpreter
 */

import type es from 'estree'
import { isArray } from 'lodash'

import type { IOptions } from '..'
import { UNKNOWN_LOCATION } from '../constants'
import * as errors from '../errors/errors'
import { RuntimeSourceError } from '../errors/runtimeSourceError'
import { checkEditorBreakpoints } from '../stdlib/inspector'
import type {
  Context,
  ContiguousArrayElements,
  Node,
  NodeTypeToNode,
  Result,
  StatementSequence,
  Value
} from '../types'
import * as ast from '../utils/ast/astCreator'
import {
  filterImportDeclarations,
  getSourceVariableDeclaration,
  hasNoDeclarations,
  hasNoImportDeclarations
} from '../utils/ast/helpers'
import { evaluateBinaryExpression, evaluateUnaryExpression } from '../utils/operators'
import * as rttc from '../utils/rttc'
import * as seq from '../utils/statementSeqTransform'
import { checkProgramForUndefinedVariables } from '../validator/validator'
import Closure from './closure'
import {
  Continuation,
  DelimitedContinuation,
  isCallWithCurrentContinuation,
  isReset,
  isShift,
  isWithHandle,
  isPerform,
  makeDummyContCallExpression
} from './continuations'
import * as instr from './instrCreator'
import { Stack } from './stack'
import {
  type AppInstr,
  CSEBreak,
  type ControlItem,
  CseError,
  type EnvStackRestoreInstr,
  type Handler,
  type HandlerControlMarkerInstr,
  HandlerStashMarker,
  InstrType,
  type InstrTypeToInstr,
  ResetStashMarker
} from './types'
import {
  checkNumberOfArguments,
  checkStackOverFlow,
  copyEnvironmentStack,
  createBlockEnvironment,
  createEnvironment,
  createProgramEnvironment,
  currentEnvironment,
  declareFunctionsAndVariables,
  declareIdentifier,
  defineVariable,
  envChanging,
  getVariable,
  handleArrayCreation,
  handleRuntimeError,
  handleSequence,
  hasBreakStatement,
  hasContinueStatement,
  isBlockStatement,
  isEnvArray,
  isEnvDependent,
  isInstr,
  isNode,
  isSimpleFunction,
  isStreamFn,
  popEnvironment,
  pushEnvironment,
  reduceConditional,
  setVariable,
  uniqueId,
  valueProducing
} from './utils'

/**
 * The control is a list of commands that still needs to be executed by the machine.
 * It contains syntax tree nodes or instructions.
 */
export class Control extends Stack<ControlItem> {
  private numEnvDependentItems: number
  public constructor(program?: es.Program | StatementSequence) {
    super()
    this.numEnvDependentItems = 0
    // Load program into control stack
    if (program) this.push(program)
  }

  public canAvoidEnvInstr(): boolean {
    return this.numEnvDependentItems === 0
  }

  public setTo(otherControl: Control): void {
    super.setTo(otherControl)
    this.numEnvDependentItems = otherControl.numEnvDependentItems
  }

  // For testing purposes
  public getNumEnvDependentItems(): number {
    return this.numEnvDependentItems
  }

  public pop(): ControlItem | undefined {
    const item = super.pop()
    if (item !== undefined && isEnvDependent(item)) {
      this.numEnvDependentItems--
    }
    return item
  }

  public push(...items: ControlItem[]): void {
    const itemsNew: ControlItem[] = Control.simplifyBlocksWithoutDeclarations(...items)
    itemsNew.forEach((item: ControlItem) => {
      if (isEnvDependent(item)) {
        this.numEnvDependentItems++
      }
    })
    super.push(...itemsNew)
  }

  /**
   * Before pushing block statements on the control stack, we check if the block statement has any declarations.
   * If not, the block is converted to a StatementSequence.
   * @param items The items being pushed on the control.
   * @returns The same set of control items, but with block statements without declarations converted to StatementSequences.
   * NOTE: this function handles any case where StatementSequence has to be converted back into BlockStatement due to type issues
   */
  private static simplifyBlocksWithoutDeclarations(...items: ControlItem[]): ControlItem[] {
    const itemsNew: ControlItem[] = []
    items.forEach(item => {
      if (isNode(item) && isBlockStatement(item) && hasNoDeclarations(item.body)) {
        // Push block body as statement sequence
        const seq: StatementSequence = ast.statementSequence(item.body, item.loc)
        itemsNew.push(seq)
      } else {
        itemsNew.push(item)
      }
    })
    return itemsNew
  }

  public copy(): Control {
    const newControl = new Control()
    const stackCopy = super.getStack()
    newControl.push(...stackCopy)
    return newControl
  }
}

/**
 * The stash is a list of values that stores intermediate results.
 */
export class Stash extends Stack<Value> {
  public constructor() {
    super()
  }

  public copy(): Stash {
    const newStash = new Stash()
    const stackCopy = super.getStack()
    newStash.push(...stackCopy)
    return newStash
  }
}

/**
 * Function to be called when a program is to be interpreted using
 * the explicit control evaluator.
 *
 * @param program The program to evaluate.
 * @param context The context to evaluate the program in.
 * @returns The result of running the CSE machine.
 */
export function evaluate(program: es.Program, context: Context, options: IOptions): Value {
  try {
    checkProgramForUndefinedVariables(program, context)
  } catch (error) {
    context.errors.push(error)
    return new CseError(error)
  }
  seq.transform(program)

  try {
    context.runtime.isRunning = true
    context.runtime.control = new Control(program)
    context.runtime.stash = new Stash()

    return runCSEMachine(
      context,
      context.runtime.control,
      context.runtime.stash,
      options.envSteps,
      options.stepLimit,
      options.isPrelude
    )
  } catch (error) {
    return new CseError(error)
  } finally {
    context.runtime.isRunning = false
  }
}

/**
 * Function that is called when a user wishes to resume evaluation after
 * hitting a breakpoint.
 * This should only be called after the first 'evaluate' function has been called so that
 * context.runtime.control and context.runtime.stash are defined.
 * @param context The context to continue evaluating the program in.
 * @returns The result of running the CSE machine.
 */
export function resumeEvaluate(context: Context) {
  try {
    context.runtime.isRunning = true
    return runCSEMachine(context, context.runtime.control!, context.runtime.stash!, -1, -1)
  } catch (error) {
    return new CseError(error)
  } finally {
    context.runtime.isRunning = false
  }
}

function evaluateImports(program: es.Program, context: Context) {
  try {
    const [importNodeMap] = filterImportDeclarations(program)

    const environment = currentEnvironment(context)
    for (const [moduleName, nodes] of importNodeMap) {
      const functions = context.nativeStorage.loadedModules[moduleName]
      for (const node of nodes) {
        for (const spec of node.specifiers) {
          declareIdentifier(context, spec.local.name, node, environment)
          let obj: any

          switch (spec.type) {
            case 'ImportSpecifier': {
              obj = functions[spec.imported.name]
              break
            }
            case 'ImportDefaultSpecifier': {
              obj = functions.default
              break
            }
            case 'ImportNamespaceSpecifier': {
              obj = functions
              break
            }
          }

          defineVariable(context, spec.local.name, obj, true, node)
        }
      }
    }
  } catch (error) {
    handleRuntimeError(context, error)
  }
}

/**
 * Function that returns the appropriate Promise<Result> given the output of CSE machine evaluating, depending
 * on whether the program is finished evaluating, ran into a breakpoint or ran into an error.
 * @param context The context of the program.
 * @param value The value of CSE machine evaluating the program.
 * @returns The corresponding promise.
 */
export function CSEResultPromise(context: Context, value: Value): Promise<Result> {
  return new Promise(resolve => {
    if (value instanceof CSEBreak) {
      resolve({ status: 'suspended-cse-eval', context })
    } else if (value instanceof CseError) {
      resolve({ context, status: 'error' })
    } else {
      resolve({ status: 'finished', context, value })
    }
  })
}

/**
 * The primary runner/loop of the explicit control evaluator.
 *
 * @param context The context to evaluate the program in.
 * @param control Points to the current context.runtime.control
 * @param stash Points to the current context.runtime.stash
 * @param isPrelude Whether the program we are running is the prelude
 * @returns A special break object if the program is interrupted by a breakpoint;
 * else the top value of the stash. It is usually the return value of the program.
 */
function runCSEMachine(
  context: Context,
  control: Control,
  stash: Stash,
  envSteps: number,
  stepLimit: number,
  isPrelude: boolean = false
) {
  const eceState = generateCSEMachineStateStream(
    context,
    control,
    stash,
    envSteps,
    stepLimit,
    isPrelude
  )

  // Done intentionally as the state is not needed
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _ of eceState) {
  }

  return stash.peek()
}

export function* generateCSEMachineStateStream(
  context: Context,
  control: Control,
  stash: Stash,
  envSteps: number,
  stepLimit: number,
  isPrelude: boolean = false
) {
  context.runtime.break = false
  context.runtime.nodes = []

  // steps: number of steps completed
  let steps = 0

  let command = control.peek()

  // Push first node to be evaluated into context.
  // The typeguard is there to guarantee that we are pushing a node (which should always be the case)
  if (command !== undefined && isNode(command)) {
    context.runtime.nodes.unshift(command)
  }

  while (command !== undefined) {
    // Return to capture a snapshot of the control and stash after the target step count is reached
    if (!isPrelude && steps === envSteps) {
      yield { stash, control, steps }
      return
    }
    // Step limit reached, stop further evaluation
    if (!isPrelude && steps === stepLimit) {
      break
    }

    if (isNode(command) && command.type === 'DebuggerStatement') {
      // steps += 1

      // Record debugger step if running for the first time
      if (envSteps === -1) {
        context.runtime.breakpointSteps.push(steps)
      }
    }

    if (!isPrelude && envChanging(command)) {
      // command is evaluated on the next step
      // Hence, next step will change the environment
      context.runtime.changepointSteps.push(steps + 1)
    }

    control.pop()
    if (isNode(command)) {
      context.runtime.nodes.shift()
      context.runtime.nodes.unshift(command)
      checkEditorBreakpoints(context, command)

      callEvaluator(command, context, control, stash, isPrelude)
      if (context.runtime.break && context.runtime.debuggerOn) {
        // We can put this under isNode since context.runtime.break
        // will only be updated after a debugger statement and so we will
        // run into a node immediately after.
        // With the new evaluator, we don't return a break
        // return new CSEBreak()
      }
    } else if (isInstr(command)) {
      // Command is an instruction
      callEvaluator(command, context, control, stash, isPrelude)
    }

    // Push undefined into the stack if both control and stash is empty
    if (control.isEmpty() && stash.isEmpty()) {
      stash.push(undefined)
    }
    command = control.peek()

    steps += 1
    if (!isPrelude) {
      context.runtime.envStepsTotal = steps
    }

    yield { stash, control, steps }
  }
}

function callEvaluator(
  command: ControlItem,
  context: Context,
  control: Control,
  stash: Stash,
  isPrelude: boolean
) {
  if (isNode(command)) {
    // @ts-expect-error Command type gets narrowed to never
    cmdEvaluators[command.type]({ command, context, control, stash, isPrelude })
  } else if (isInstr(command)) {
    // @ts-expect-error Command type gets narrowed to never
    cmdEvaluators[command.instrType]({ command, context, control, stash, isPrelude })
  }
}

type CmdEvaluator<T extends ControlItem> = (arg: {
  command: T
  context: Context
  control: Control
  stash: Stash
  isPrelude: boolean
}) => void

type CommandEvaluators = {
  [K in Node['type']]?: CmdEvaluator<NodeTypeToNode<K>>
} & {
  [K in InstrType]?: CmdEvaluator<InstrTypeToInstr<K>>
}

/**
 * Dictionary of functions which handle the logic for the response of the three registers of
 * the CSE machine to each ControlItem.
 */
const cmdEvaluators: CommandEvaluators = {
  /**
   * Statements
   */
  BlockStatement({ command, context, control }) {
    // To restore environment after block ends
    // If there is an env instruction on top of the stack, or if there are no declarations
    // we do not need to push another one
    // The no declarations case is handled at the transform stage, so no blockStatement node without declarations should end up here.
    const next = control.peek()

    // Push ENVIRONMENT instruction if needed - if next control stack item
    // exists and is not an environment instruction, OR the control only contains
    // environment indepedent items
    if (
      next &&
      !(isInstr(next) && next.instrType === InstrType.ENVIRONMENT) &&
      !control.canAvoidEnvInstr()
    ) {
      control.push(instr.envInstr(currentEnvironment(context), command))
    }

    const environment = createBlockEnvironment(context, 'blockEnvironment')
    declareFunctionsAndVariables(context, command, environment)
    pushEnvironment(context, environment)

    // Push block body as statement sequence
    const seq = ast.statementSequence(command.body, command.loc)
    control.push(seq)
  },

  BreakStatement({ command, control }) {
    control.push(instr.breakInstr(command))
  },

  ContinueStatement({ command, control }) {
    control.push(instr.contInstr(command))
  },

  DebuggerStatement({ context }) {
    context.runtime.break = true
  },

  ExpressionStatement({ command, context, control, stash, isPrelude }) {
    // Fast forward to the expression
    // If not the next step will look like it's only removing ';'
    callEvaluator(command.expression, context, control, stash, isPrelude)
  },

  ForStatement({ command, control }) {
    // All 3 parts will be defined due to parser rules
    const init = command.init!
    const test = command.test!
    const update = command.update!

    // Loop control variable present
    // Refer to Source §3 specifications https://docs.sourceacademy.org/source_3.pdf
    if (init.type === 'VariableDeclaration' && init.kind === 'let') {
      const { id } = getSourceVariableDeclaration(init)
      control.push(
        ast.blockStatement(
          [
            init,
            ast.forStatement(
              ast.assignmentExpression(id, ast.identifier(id.name, command.loc), command.loc),
              test,
              update,
              ast.blockStatement(
                [
                  ast.variableDeclaration(
                    [
                      ast.variableDeclarator(
                        ast.identifier(`_copy_of_${id.name}`, command.loc),
                        ast.identifier(id.name, command.loc),
                        command.loc
                      )
                    ],
                    'const',
                    command.loc
                  ),
                  ast.blockStatement(
                    [
                      ast.variableDeclaration(
                        [
                          ast.variableDeclarator(
                            ast.identifier(id.name, command.loc),
                            ast.identifier(`_copy_of_${id.name}`, command.loc),
                            command.loc
                          )
                        ],
                        'const',
                        command.loc
                      ),
                      command.body
                    ],
                    command.loc
                  )
                ],
                command.loc
              ),
              command.loc
            )
          ],
          command.loc
        )
      )
    } else {
      if (hasBreakStatement(command.body as es.BlockStatement)) {
        control.push(instr.breakMarkerInstr(command))
      }
      control.push(instr.forInstr(init, test, update, command.body, command))
      control.push(test)
      control.push(instr.popInstr(command)) // Pop value from init assignment
      control.push(init)
      control.push(ast.identifier('undefined', command.loc)) // Return undefined if there is no loop execution
    }
  },

  FunctionDeclaration({ command, control }) {
    // Function declaration desugared into constant declaration.
    const lambdaExpression = ast.blockArrowFunction(
      command.params as es.Identifier[],
      command.body,
      command.loc
    )
    const lambdaDeclaration = ast.constantDeclaration(
      command.id!.name,
      lambdaExpression,
      command.loc
    )
    control.push(lambdaDeclaration)
  },

  IfStatement({ command, control }) {
    control.push(...reduceConditional(command))
  },

  ImportDeclaration() {},

  Program({ command, context, control, isPrelude }) {
    // After execution of a program, the current environment might be a local one.
    // This can cause issues (for example, during execution of consecutive REPL programs)
    // This piece of code will reset the current environment to either a global one, a program one or a prelude one.
    while (
      currentEnvironment(context).name !== 'global' &&
      currentEnvironment(context).name !== 'programEnvironment' &&
      currentEnvironment(context).name !== 'prelude'
    ) {
      popEnvironment(context)
    }

    // If the program has outer declarations:
    // - Create the program environment (if none exists yet), and
    // - Declare the functions and variables in the program environment.
    if (!hasNoDeclarations(command.body) || !hasNoImportDeclarations(command.body)) {
      if (currentEnvironment(context).name !== 'programEnvironment') {
        const programEnv = createProgramEnvironment(context, isPrelude)
        pushEnvironment(context, programEnv)
      }
      const environment = currentEnvironment(context)
      evaluateImports(command, context)
      declareFunctionsAndVariables(context, command, environment)
    }

    if (command.body.length === 1) {
      // If program only consists of one statement, unwrap outer block
      control.push(...handleSequence(command.body))
    } else {
      // Push block body as statement sequence
      const seq = ast.statementSequence(command.body as es.Statement[], command.loc)
      control.push(seq)
    }
  },

  ReturnStatement({ command, control }) {
    // Push return argument onto control as well as Reset Instruction to clear to ignore all statements after the return.
    const next = control.peek()
    if (next && isInstr(next) && next.instrType === InstrType.MARKER) {
      control.pop()
    } else {
      control.push(instr.resetInstr(command))
    }
    if (command.argument) {
      control.push(command.argument)
    }
  },

  StatementSequence({ command, context, control, stash, isPrelude }) {
    if (command.body.length == 1) {
      // If sequence only consists of one statement, evaluate it immediately
      const next = command.body[0]
      callEvaluator(next, context, control, stash, isPrelude)
    } else {
      // unpack and push individual nodes in body
      control.push(...handleSequence(command.body))
    }
    return
  },

  VariableDeclaration({ command, control }) {
    const { init, id } = getSourceVariableDeclaration(command)
    control.push(instr.popInstr(command))
    control.push(instr.assmtInstr(id.name, command))
    control.push(init)
  },

  WhileStatement({ command, control }) {
    if (hasBreakStatement(command.body as es.BlockStatement)) {
      control.push(instr.breakMarkerInstr(command))
    }
    control.push(instr.whileInstr(command.test, command.body, command))
    control.push(command.test)
    control.push(ast.identifier('undefined', command.loc)) // Return undefined if there is no loop execution
  },

  /**
   * Expressions
   */
  ArrayExpression({ command, control }) {
    const elems = command.elements as ContiguousArrayElements
    const len = elems.length

    control.push(instr.arrLitInstr(len, command))
    for (let i = len - 1; i >= 0; i--) {
      control.push(elems[i])
    }
  },

  ArrowFunctionExpression({ command, context, stash, isPrelude }) {
    const closure = Closure.makeFromArrowFunction(
      command,
      currentEnvironment(context),
      context,
      true,
      isPrelude
    )
    stash.push(closure)
  },

  ObjectExpression({ command, control }) {
    const properties = command.properties as es.Property[]
    const keys: string[] = []

    for (const prop of properties) {
      if (prop.key.type === 'Identifier') {
        keys.push(prop.key.name)
      } else if (prop.key.type === 'Literal') {
        keys.push(String(prop.key.value))
      }
    }

    control.push(instr.objLitInstr(keys, command))
    for (let i = properties.length - 1; i >= 0; i--) {
      control.push(properties[i].value)
    }
  },

  MemberExpression({ command, control }) {
    control.push(instr.arrAccInstr(command))
    control.push(command.property)
    control.push(command.object)
  },

  AssignmentExpression({ command, control }) {
    if (command.left.type === 'MemberExpression') {
      control.push(instr.arrAssmtInstr(command))
      control.push(command.right)
      control.push(command.left.property)
      control.push(command.left.object)
    } else if (command.left.type === 'Identifier') {
      const id = command.left
      control.push(instr.assmtInstr(id.name, command))
      control.push(command.right)
    }
  },

  BinaryExpression({ command, control }) {
    control.push(instr.binOpInstr(command.operator, command))
    control.push(command.right)
    control.push(command.left)
  },

  CallExpression({ command, control }) {
    // Push application instruction, function arguments and function onto control.
    control.push(instr.appInstr(command.arguments.length, command))
    for (let index = command.arguments.length - 1; index >= 0; index--) {
      control.push(command.arguments[index])
    }
    control.push(command.callee)
  },

  ConditionalExpression({ command, control }) {
    control.push(...reduceConditional(command))
  },

  Identifier({ command, context, stash }) {
    stash.push(getVariable(context, command.name, command))
  },

  Literal({ command, stash }) {
    stash.push(command.value)
  },

  LogicalExpression({ command, control }) {
    if (command.operator === '&&') {
      control.push(
        ast.conditionalExpression(command.left, command.right, ast.literal(false), command.loc)
      )
    } else {
      control.push(
        ast.conditionalExpression(command.left, ast.literal(true), command.right, command.loc)
      )
    }
  },

  SpreadElement({ command, control }) {
    const arr = command.argument as es.ArrayExpression
    control.push(instr.spreadInstr(arr))
    control.push(arr)
  },

  UnaryExpression({ command, control }) {
    control.push(instr.unOpInstr(command.operator, command))
    control.push(command.argument)
  },

  /**
   * Instructions
   */
  [InstrType.APPLICATION]({ command, context, control, stash }) {
    checkStackOverFlow(context, control)
    // Get function arguments from the stash
    const args: Value[] = []
    for (let index = 0; index < command.numOfArgs; index++) {
      args.unshift(stash.pop())
    }

    // Get function from the stash
    const func: Closure | Function = stash.pop()

    if (!(func instanceof Closure || func instanceof Function)) {
      handleRuntimeError(context, new errors.CallingNonFunctionValue(func, command.srcNode))
    }

    if (isCallWithCurrentContinuation(func)) {
      // Check for number of arguments mismatch error
      checkNumberOfArguments(context, func, args, command.srcNode)

      // generate a continuation here
      const contControl = control.copy()
      const contStash = stash.copy()
      const contEnv = context.runtime.environments.slice()

      // at this point, the extra CALL instruction
      // has been removed from the control stack.
      // additionally, the single closure argument has been
      // removed (as the parameter of call/cc) from the stash
      // and additionally, call/cc itself has been removed from the stash.

      const continuation = new Continuation(context, contControl, contStash, contEnv)

      // Get the callee
      const cont_callee: Value = args[0]

      const dummyFCallExpression = makeDummyContCallExpression('f', 'cont')

      // Prepare a function call for the continuation-consuming function
      control.push(instr.appInstr(command.numOfArgs, dummyFCallExpression))

      // push the argument (the continuation caller) back onto the stash
      stash.push(cont_callee)

      // finally, push the continuation onto the stash
      stash.push(continuation)
      return
    }

    // Handle reset(f) - places delimiter markers on control and stash
    if (isReset(func)) {
      // Check for number of arguments mismatch error
      checkNumberOfArguments(context, func, args, command.srcNode)

      // reset rule: (reset(f):C, S, E) ↪ (app_i(0):reset_control_marker:C, f:reset_stash_marker:S, E)
      // Push reset control marker
      control.push(instr.resetControlMarkerInstr(command.srcNode))
      // Push application instruction to apply the nullary function f
      control.push(instr.appInstr(0, command.srcNode))

      // Push the function f onto stash
      stash.push(args[0])
      // Push reset stash marker below the function
      const stashItems = stash.getStack()
      const fValue = stashItems.pop()
      stashItems.push(new ResetStashMarker())
      stashItems.push(fValue)
      stash.setTo(new Stash())
      for (const item of stashItems) {
        stash.push(item)
      }
      return
    }

    // Handle shift(f) - captures delimited continuation up to reset marker
    if (isShift(func)) {
      // Check for number of arguments mismatch error
      checkNumberOfArguments(context, func, args, command.srcNode)

      // Get the function f that will receive the continuation
      const shiftFunction = args[0]

      // Pop control items until we find a reset control marker
      const capturedControl: ControlItem[] = []
      const controlStack = control.getStack()
      let foundMarker = false
      let markerIndex = -1

      // Find the reset control marker in the control stack
      for (let i = controlStack.length - 1; i >= 0; i--) {
        const item = controlStack[i]
        if (isInstr(item) && item.instrType === InstrType.RESET_CONTROL_MARKER) {
          foundMarker = true
          markerIndex = i
          break
        }
      }

      // Pop stash items until we find a reset stash marker
      const capturedStash: Value[] = []
      const stashStack = stash.getStack()
      let stashMarkerIndex = -1

      for (let i = stashStack.length - 1; i >= 0; i--) {
        if (stashStack[i] instanceof ResetStashMarker) {
          stashMarkerIndex = i
          break
        }
      }

      if (foundMarker && stashMarkerIndex >= 0) {
        // shift rule (with markers):
        // Capture control from current position to marker (inclusive of marker for reinstating)
        for (let i = markerIndex; i < controlStack.length; i++) {
          capturedControl.push(controlStack[i])
        }

        // Capture stash from marker to current position (inclusive of marker)
        for (let i = stashMarkerIndex; i < stashStack.length; i++) {
          capturedStash.push(stashStack[i])
        }

        // Create the delimited continuation
        // Copy entire environment stack at capture time for multi-shot support
        const capturedEnvStack = copyEnvironmentStack(context.runtime.environments)
        const delimitedCont = new DelimitedContinuation(
          context,
          capturedControl,
          capturedStash,
          capturedEnvStack
        )

        // Remove captured items from control (everything from marker onwards)
        const newControl = new Control()
        for (let i = 0; i < markerIndex; i++) {
          newControl.push(controlStack[i])
        }
        control.setTo(newControl)

        // Remove captured items from stash (everything from marker onwards)
        const newStash = new Stash()
        for (let i = 0; i < stashMarkerIndex; i++) {
          newStash.push(stashStack[i])
        }
        stash.setTo(newStash)

        // Push new reset markers (shift reinstates the delimiter)
        control.push(instr.resetControlMarkerInstr(command.srcNode))
        stash.push(new ResetStashMarker())

        // Apply f to the continuation: (app_i(1):reset_control_marker:C, cont:f:reset_stash_marker:S, E)
        control.push(instr.appInstr(1, command.srcNode))
        stash.push(shiftFunction)
        stash.push(delimitedCont)
      } else {
        // shift rule (without markers): capture full control and stash like call/cc
        const fullControl = control.getStack()
        const fullStash = stash.getStack()

        // Copy entire environment stack at capture time for multi-shot support
        const capturedEnvStack = copyEnvironmentStack(context.runtime.environments)
        const delimitedCont = new DelimitedContinuation(
          context,
          fullControl,
          fullStash,
          capturedEnvStack
        )

        // Clear control and stash
        control.setTo(new Control())
        stash.setTo(new Stash())

        // Apply f to the continuation
        control.push(instr.appInstr(1, command.srcNode))
        stash.push(shiftFunction)
        stash.push(delimitedCont)
      }
      return
    }

    // Handle withHandle(handler, body) - places handler markers on control and stash
    if (isWithHandle(func)) {
      // Check for number of arguments mismatch error
      checkNumberOfArguments(context, func, args, command.srcNode)

      // withHandle rule:
      // (withHandle(handler, body):C, S, E) ↪ (app_i(0):handler_control_marker(handler, id):C, body:handler_stash_marker(id):S, E)
      const handler = args[0] as Record<string, any>
      const body = args[1]

      // Generate unique id for this handler frame
      const handlerId = uniqueId(context)

      // Convert handler object to Map
      const handlerMap: Handler = new Map()
      for (const key of Object.keys(handler)) {
        handlerMap.set(key, handler[key])
      }

      // Push handler control marker
      control.push(instr.handlerControlMarkerInstr(handlerMap, handlerId, command.srcNode))
      // Push application instruction to apply the nullary body function
      control.push(instr.appInstr(0, command.srcNode))

      // Push the body function onto stash
      stash.push(body)
      // Push handler stash marker below the body
      const stashItems = stash.getStack()
      const bodyValue = stashItems.pop()
      stashItems.push(new HandlerStashMarker(handlerId))
      stashItems.push(bodyValue)
      stash.setTo(new Stash())
      for (const item of stashItems) {
        stash.push(item)
      }
      return
    }

    // Handle perform(op, ...args) - captures continuation up to handler that handles op
    if (isPerform(func)) {
      // Get the operation name (first argument)
      const opName = args[0] as string

      // Get the remaining arguments
      const opArgs = args.slice(1)

      // Find the handler control marker that handles this operation
      // Search from top of control stack downward to find the nearest enclosing handler,
      // matching the OCaml S4S semantics (linear search through the control stack)
      const controlStack = control.getStack()
      let foundHandler = false
      let markerIndex = -1
      let handlerMarker: HandlerControlMarkerInstr | null = null

      for (let i = controlStack.length - 1; i >= 0; i--) {
        const item = controlStack[i]
        if (isInstr(item) && item.instrType === InstrType.HANDLER_CONTROL_MARKER) {
          const marker = item as HandlerControlMarkerInstr
          if (marker.handler.has(opName)) {
            foundHandler = true
            markerIndex = i
            handlerMarker = marker
            break
          }
        }
      }

      if (!foundHandler || !handlerMarker) {
        return handleRuntimeError(
          context,
          new errors.ExceptionError(new Error(`No handler found for operation: ${opName}`), UNKNOWN_LOCATION)
        )
      }

      // Find the corresponding stash marker
      const stashStack = stash.getStack()
      let stashMarkerIndex = -1

      for (let i = stashStack.length - 1; i >= 0; i--) {
        if (stashStack[i] instanceof HandlerStashMarker && stashStack[i].id === handlerMarker.id) {
          stashMarkerIndex = i
          break
        }
      }

      if (stashMarkerIndex < 0) {
        return handleRuntimeError(
          context,
          new errors.ExceptionError(new Error(`Handler stash marker not found for operation: ${opName}`), UNKNOWN_LOCATION)
        )
      }

      // Capture control from marker to current position (inclusive of marker for deep handlers)
      // The marker will be reinstalled when the continuation is applied
      const capturedControl: ControlItem[] = []
      for (let i = markerIndex; i < controlStack.length; i++) {
        capturedControl.push(controlStack[i])
      }

      // Capture stash from marker to current position (inclusive of marker)
      const capturedStash: Value[] = []
      for (let i = stashMarkerIndex; i < stashStack.length; i++) {
        capturedStash.push(stashStack[i])
      }

      // Create the delimited continuation with handler info
      // Copy entire environment stack at capture time for multi-shot support
      const capturedEnvStack = copyEnvironmentStack(context.runtime.environments)
      const delimitedCont = new DelimitedContinuation(
        context,
        capturedControl,
        capturedStash,
        capturedEnvStack,
        handlerMarker.handler,
        handlerMarker.id
      )

      // Remove captured items from control (everything from marker onwards)
      // The markers are already included in the captured continuation for deep handler semantics
      const newControl = new Control()
      for (let i = 0; i < markerIndex; i++) {
        newControl.push(controlStack[i])
      }
      control.setTo(newControl)

      // Remove captured items from stash (everything from marker onwards)
      const newStash = new Stash()
      for (let i = 0; i < stashMarkerIndex; i++) {
        newStash.push(stashStack[i])
      }
      stash.setTo(newStash)

      // Get the handler function for this operation
      const handlerFn = handlerMarker.handler.get(opName)

      // Apply handler function: handler takes (k, ...args) where k is the continuation
      // Push application instruction for (1 + number of op args) arguments
      control.push(instr.appInstr(1 + opArgs.length, command.srcNode))

      // Push handler function and arguments onto stash
      stash.push(handlerFn)
      stash.push(delimitedCont)
      for (const arg of opArgs) {
        stash.push(arg)
      }

      return
    }

    // Handle delimited continuation application
    if (func instanceof DelimitedContinuation) {
      // Check for number of arguments mismatch error
      checkNumberOfArguments(context, func, args, command.srcNode)

      // Continuation application rule (following OCaml S4S):
      // (app_i(1):C, v:cont(C', S', E'):S, E) ↪ (C' ++ env_i(E):C, v:S' ++ S, E')

      // Get the captured state from the continuation
      const contControl = func.getControl()
      const contStash = func.getStash()
      const contEnvStack = func.getEnvStack()

      // Build new control: captured control ++ env_i(current_env) ++ current control
      const currentControlStack = control.getStack()
      const newControl = new Control()

      // First push current control items
      for (const item of currentControlStack) {
        newControl.push(item)
      }

      // Push environment stack restoration instruction to restore entire env stack after continuation finishes
      // Using the new ENV_STACK_RESTORE instruction since we replace the whole stack, not just pop to an environment
      // IMPORTANT: Copy the stack now, as it will be modified by the captured continuation
      newControl.push(instr.envStackRestoreInstr(copyEnvironmentStack(context.runtime.environments), command.srcNode))

      // Push captured control items
      for (const item of contControl) {
        newControl.push(item)
      }

      control.setTo(newControl)

      // Build new stash: v : captured stash ++ current stash
      const currentStashStack = stash.getStack()
      const newStash = new Stash()

      // First push current stash items
      for (const item of currentStashStack) {
        newStash.push(item)
      }

      // Push captured stash items
      for (const item of contStash) {
        newStash.push(item)
      }

      // Push the argument value on top
      for (const arg of args) {
        newStash.push(arg)
      }

      stash.setTo(newStash)

      // Restore the environment from the continuation
      // Copy at application time for multi-shot support (each invocation needs fresh copy)
      // Directly replace the environment stack like OCaml S4S does
      context.runtime.environments = copyEnvironmentStack(contEnvStack)

      return
    }

    if (func instanceof Continuation) {
      // Check for number of arguments mismatch error
      checkNumberOfArguments(context, func, args, command.srcNode)

      // get the C, S, E from the continuation
      const contControl = func.getControl()
      const contStash = func.getStash()
      const contEnv = func.getEnv()

      // update the C, S, E of the current context
      control.setTo(contControl)
      stash.setTo(contStash)
      context.runtime.environments = contEnv

      // push the arguments back onto the stash
      stash.push(...args)
      return
    }

    if (func instanceof Closure) {
      // Check for number of arguments mismatch error
      checkNumberOfArguments(context, func, args, command.srcNode)

      const next = control.peek()

      // Push ENVIRONMENT instruction if needed - if next control stack item
      // exists and is not an environment instruction, OR the control only contains
      // environment indepedent items
      // if the current language is a scheme language, don't avoid the environment instruction
      // as schemers like using the REPL, and that always assumes that the environment is reset
      // to the main environment.
      if (
        next &&
        !(isInstr(next) && next.instrType === InstrType.ENVIRONMENT) &&
        !control.canAvoidEnvInstr()
      ) {
        control.push(instr.envInstr(currentEnvironment(context), command.srcNode))
      }

      // Create environment for function parameters if the function isn't nullary.
      // Name the environment if the function call expression is not anonymous
      if (args.length > 0) {
        const environment = createEnvironment(context, func, args, command.srcNode)
        pushEnvironment(context, environment)
      } else {
        context.runtime.environments.unshift(func.environment)
      }

      // Handle special case if function is simple
      if (isSimpleFunction(func.node)) {
        // Closures convert ArrowExpressionStatements to BlockStatements
        const block = func.node.body as es.BlockStatement
        const returnStatement = block.body[0] as es.ReturnStatement
        control.push(returnStatement.argument ?? ast.identifier('undefined', returnStatement.loc))
      } else {
        if (control.peek()) {
          // push marker if control not empty
          control.push(instr.markerInstr(command.srcNode))
        }
        control.push(func.node.body)
      }

      return
    }

    // Value is a built-in function
    // Check for number of arguments mismatch error
    checkNumberOfArguments(context, func, args, command.srcNode)
    // Directly stash result of applying pre-built functions without the CSE machine.
    try {
      const result = func(...args)

      if (isStreamFn(func, result)) {
        // This is a special case for the `stream` built-in function, since it returns pairs
        // whose last element is a function. The CSE machine on the frontend will still draw
        // these functions like closures, and the tail of the "closures" will need to point
        // to where `stream` was called.
        //
        // TODO: remove this condition if `stream` becomes a pre-defined function
        Object.defineProperties(result[1], {
          environment: { value: currentEnvironment(context), writable: true }
        })
      }

      // Recursively adds `environment` and `id` properties to any arrays created,
      // and also adds them to the heap starting from the arrays that are more deeply nested.
      const attachEnvToResult = (value: any) => {
        // Built-in functions don't instantly create arrays with circular references, so
        // there is no need to keep track of visited arrays.
        if (isArray(value) && !isEnvArray(value)) {
          for (const item of value) {
            attachEnvToResult(item)
          }
          handleArrayCreation(context, value)
        }
      }
      attachEnvToResult(result)

      stash.push(result)
    } catch (error) {
      if (!(error instanceof RuntimeSourceError || error instanceof errors.ExceptionError)) {
        // The error could've arisen when the builtin called a source function which errored.
        // If the cause was a source error, we don't want to include the error.
        // However if the error came from the builtin itself, we need to handle it.
        const loc = command.srcNode.loc ?? UNKNOWN_LOCATION
        handleRuntimeError(context, new errors.ExceptionError(error, loc))
      }
    }
    return
  },

  [InstrType.ENV_STACK_RESTORE]({ command, context }: { command: EnvStackRestoreInstr, context: Context }) {
    context.runtime.environments = command.envStack
  },

  [InstrType.OBJECT_LITERAL]({ command, stash }) {
    const keys = command.keys
    const obj: Record<string, any> = {}
    for (let i = keys.length - 1; i >= 0; i--) {
      obj[keys[i]] = stash.pop()
    }
    stash.push(obj)
  },

  [InstrType.ARRAY_ACCESS]({ command, context, stash }) {
    const index = stash.pop()
    const array = stash.pop()

    //Check if the index is legal
    const indexRangeError = rttc.checkoutofRange(command.srcNode, index, context.chapter)
    if (indexRangeError) {
      handleRuntimeError(context, indexRangeError)
    }

    // Check if left-hand side is array
    const lhsArrayCheckError = rttc.checkArray(command.srcNode, array, context.chapter)
    if (lhsArrayCheckError) {
      handleRuntimeError(context, lhsArrayCheckError)
    }

    // Check if index is out-of-bounds with array, in which case, returns undefined as per spec
    if (index >= array.length) {
      stash.push(undefined)
    } else {
      stash.push(array[index])
    }
  },

  [InstrType.ARRAY_LITERAL]({ command, context, stash }) {
    const arity = command.arity
    const array = []
    for (let i = 0; i < arity; ++i) {
      array.unshift(stash.pop())
    }
    handleArrayCreation(context, array)
    stash.push(array)
  },

  [InstrType.ARRAY_ASSIGNMENT]({ stash }) {
    const value = stash.pop()
    const index = stash.pop()
    const array = stash.pop()
    array[index] = value
    stash.push(value)
  },

  [InstrType.ASSIGNMENT]({ command, context, stash }) {
    if (command.declaration) {
      defineVariable(context, command.symbol, stash.peek(), command.constant, command.srcNode)
    } else {
      setVariable(context, command.symbol, stash.peek(), command.srcNode)
    }
  },

  [InstrType.BINARY_OP]({ command, context, stash }) {
    const right = stash.pop()
    const left = stash.pop()
    const error = rttc.checkBinaryExpression(
      command.srcNode,
      command.symbol,
      context.chapter,
      left,
      right
    )
    if (error) {
      handleRuntimeError(context, error)
    }
    stash.push(evaluateBinaryExpression(command.symbol, left, right))
  },

  [InstrType.BRANCH]({ command, context, control, stash }) {
    const test = stash.pop()

    // Check if test condition is a boolean
    const error = rttc.checkIfStatement(command.srcNode, test, context.chapter)
    if (error) {
      handleRuntimeError(context, error)
    }

    if (test) {
      if (!valueProducing(command.consequent)) {
        control.push(ast.identifier('undefined', command.consequent.loc))
      }
      control.push(command.consequent)
    } else if (command.alternate) {
      if (!valueProducing(command.alternate)) {
        control.push(ast.identifier('undefined', command.consequent.loc))
      }
      control.push(command.alternate)
    } else {
      control.push(ast.identifier('undefined', command.srcNode.loc))
    }
  },

  [InstrType.BREAK]({ command, control }) {
    const next = control.pop() as ControlItem
    if (isInstr(next) && next.instrType == InstrType.BREAK_MARKER) {
      // Encountered break mark, stop popping
    } else if (isInstr(next) && next.instrType == InstrType.ENVIRONMENT) {
      control.push(command)
      control.push(next) // Let instruction evaluate to restore env
    } else {
      // Continue popping from control by pushing same instruction on control
      control.push(command)
    }
  },

  [InstrType.BREAK_MARKER]() {},

  [InstrType.CONTINUE]({ command, control }) {
    const next = control.pop() as ControlItem
    if (isInstr(next) && next.instrType == InstrType.CONTINUE_MARKER) {
      // Encountered continue mark, stop popping
    } else if (isInstr(next) && next.instrType == InstrType.ENVIRONMENT) {
      control.push(command)
      control.push(next) // Let instruction evaluate to restore env
    } else {
      // Continue popping from control by pushing same instruction on control
      control.push(command)
    }
  },

  [InstrType.CONTINUE_MARKER]() {},

  [InstrType.ENVIRONMENT]({ command, context }) {
    // Restore environment
    while (currentEnvironment(context).id !== command.env.id) {
      popEnvironment(context)
    }
  },

  [InstrType.FOR]({ command, context, control, stash }) {
    const test = stash.pop()

    // Check if test condition is a boolean
    const error = rttc.checkIfStatement(command.srcNode, test, context.chapter)
    if (error) {
      handleRuntimeError(context, error)
    }

    if (test) {
      control.push(command)
      control.push(command.test)
      control.push(instr.popInstr(command.srcNode)) // Pop value from update
      control.push(command.update)
      if (hasContinueStatement(command.body as es.BlockStatement)) {
        control.push(instr.contMarkerInstr(command.srcNode))
      }
      if (!valueProducing(command.body)) {
        // if loop body is not value-producing, insert undefined expression statement
        control.push(ast.identifier('undefined', command.body.loc))
      }
      control.push(command.body)
      control.push(instr.popInstr(command.srcNode)) // Pop previous body value
    }
  },

  [InstrType.POP]({ stash }) {
    stash.pop()
  },

  [InstrType.RESET]({ command, control }) {
    // Keep pushing reset instructions until marker is found.
    const cmdNext: ControlItem | undefined = control.pop()
    if (cmdNext && (!isInstr(cmdNext) || cmdNext.instrType !== InstrType.MARKER)) {
      control.push(instr.resetInstr(command.srcNode))
    }
  },

  [InstrType.SPREAD]({ command, context, control, stash }) {
    const array = stash.pop()

    // Check if right-hand side is array
    const rhsArrayCheckError = rttc.checkArray(command.srcNode, array, context.chapter)
    if (rhsArrayCheckError) {
      handleRuntimeError(context, rhsArrayCheckError)
    }

    // spread array
    for (let i = 0; i < array.length; i++) {
      stash.push(array[i])
    }

    // update call instr above
    const cont = control.getStack()
    const size = control.size()
    for (let i = size - 1; i >= 0; i--) {
      // guaranteed at least one call instr above, because spread is not allowed inside arrays
      if ((cont[i] as AppInstr).instrType === InstrType.APPLICATION) {
        ;(cont[i] as AppInstr).numOfArgs += array.length - 1
        break // only the nearest call instruction above
      }
    }
  },

  // Delimited continuation marker rule
  [InstrType.RESET_CONTROL_MARKER]({ stash }) {
    const stashStack = stash.getStack()
    let markerIndex = -1
    for (let i = stashStack.length - 1; i >= 0; i--) {
      if (stashStack[i] instanceof ResetStashMarker) {
        markerIndex = i
        break
      }
    }
    if (markerIndex >= 0) {
      const valuesAboveMarker = stashStack.slice(markerIndex + 1)
      const newStash = new Stash()
      for (let i = 0; i < markerIndex; i++) {
        newStash.push(stashStack[i])
      }
      for (const v of valuesAboveMarker) {
        newStash.push(v)
      }
      stash.setTo(newStash)
    }
  },

  // Handler control marker rule
  [InstrType.HANDLER_CONTROL_MARKER]({ command, stash }: { command: HandlerControlMarkerInstr, stash: Stash }) {
    const stashStack = stash.getStack()
    let markerIndex = -1
    for (let i = stashStack.length - 1; i >= 0; i--) {
      if (stashStack[i] instanceof HandlerStashMarker && stashStack[i].id === command.id) {
        markerIndex = i
        break
      }
    }
    if (markerIndex >= 0) {
      const valuesAboveMarker = stashStack.slice(markerIndex + 1)
      const newStash = new Stash()
      for (let i = 0; i < markerIndex; i++) {
        newStash.push(stashStack[i])
      }
      for (const v of valuesAboveMarker) {
        newStash.push(v)
      }
      stash.setTo(newStash)
    }
  },

  [InstrType.UNARY_OP]({ command, context, stash }) {
    const argument = stash.pop()
    const error = rttc.checkUnaryExpression(
      command.srcNode,
      command.symbol,
      argument,
      context.chapter
    )
    if (error) {
      handleRuntimeError(context, error)
    }
    stash.push(evaluateUnaryExpression(command.symbol, argument))
  },

  [InstrType.WHILE]({ command, context, control, stash }) {
    const test = stash.pop()

    const error = rttc.checkIfStatement(command.srcNode, test, context.chapter)
    if (error) {
      handleRuntimeError(context, error)
    }

    if (test) {
      control.push(command)
      control.push(command.test)
      if (hasContinueStatement(command.body as es.BlockStatement)) {
        control.push(instr.contMarkerInstr(command.srcNode))
      }
      if (!valueProducing(command.body)) {
        control.push(ast.identifier('undefined', command.body.loc))
      }
      control.push(command.body)
      control.push(instr.popInstr(command.srcNode))
    }
  }
}
