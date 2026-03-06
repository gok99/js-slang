import { Parser, type Token, tokenizer } from 'acorn'
import type es from 'estree'

import { DEFAULT_ECMA_VERSION } from '../../constants'
import { Chapter, Variant } from '../../langs'
import type { Context, Node } from '../../types'
import { ancestor, AncestorWalkerFn } from '../../utils/ast/walkers'
import { DisallowedConstructError, FatalSyntaxError } from '../errors'
import type { AcornOptions, Parser as ParserInterface } from '../types'
import { createAcornParserOptions, positionToSourceLocation } from '../utils'
import syntaxBlacklist from './syntax'

const mapToObj = <T>(map: Map<string, T>) =>
  Array.from(map).reduce((obj, [k, v]) => Object.assign(obj, { [k]: v }), {})

export class S4SParser implements ParserInterface<AcornOptions> {
  private chapter: Chapter
  private variant: Variant

  constructor(chapter: Chapter, variant: Variant) {
    this.chapter = chapter
    this.variant = variant
  }

  static tokenize(programStr: string, context: Context): Token[] {
    return [
      ...tokenizer(programStr, createAcornParserOptions(DEFAULT_ECMA_VERSION, context.errors))
    ]
  }

  parse(
    programStr: string,
    context: Context,
    options?: Partial<AcornOptions>,
    throwOnError?: boolean
  ): es.Program | null {
    try {
      return Parser.parse(
        programStr,
        createAcornParserOptions(DEFAULT_ECMA_VERSION, context.errors, options)
      ) as unknown as es.Program
    } catch (error) {
      if (error instanceof SyntaxError) {
        error = new FatalSyntaxError(
          positionToSourceLocation((error as any).loc, options?.sourceFile),
          error.toString()
        )
      }

      if (throwOnError) throw error
      context.errors.push(error)
    }

    return null
  }

  validate(ast: es.Program, context: Context, throwOnError?: boolean): boolean {
    const validationWalkers: Map<string, AncestorWalkerFn<any>> = new Map()
    this.getDisallowedSyntaxes().forEach((syntaxNodeName: string) => {
      validationWalkers.set(syntaxNodeName, (node: Node, _state: any, _ancestors: [Node]) => {
        if (node.type != syntaxNodeName) return

        const error: DisallowedConstructError = new DisallowedConstructError(node)
        if (throwOnError) throw error
        context.errors.push(error)
      })
    })

    ancestor(ast as Node, mapToObj(validationWalkers), undefined, undefined)
    return context.errors.length == 0
  }

  toString(): string {
    return `S4SParser{chapter: ${this.chapter}, variant: ${this.variant}}`
  }

  private getDisallowedSyntaxes(): string[] {
    return Object.entries(syntaxBlacklist).reduce(
      (acc, [nodeName, chapterAllowed]) =>
        this.chapter < chapterAllowed ? [...acc, nodeName] : acc,
      []
    )
  }
}
