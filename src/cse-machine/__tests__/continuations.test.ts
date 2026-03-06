import { expect, test } from 'vitest'
import { mockContext } from '../../utils/testing/mocks'
import {
  Call_cc,
  Continuation,
  DelimitedContinuation,
  isCallWithCurrentContinuation,
  isPerform,
  isReset,
  isShift,
  isWithHandle,
  Perform,
  Reset,
  Shift,
  WithHandle
} from '../continuations'
import { Control, Stash } from '../interpreter'

test('call/cc is a singleton', () => {
  expect(Call_cc.get()).toBe(Call_cc.get())
})

test('call/cc toString', () => {
  expect(Call_cc.get().toString()).toBe('call/cc')
})

test('isCallWithCurrentContinuation works on call/cc only', () => {
  expect(isCallWithCurrentContinuation(Call_cc.get())).toBe(true)
  expect(isCallWithCurrentContinuation(1)).toBe(false)
})

test('Continuation toString', () => {
  const cont = new Continuation(mockContext(), new Control(), new Stash(), [])
  expect(cont.toString()).toBe('continuation')
})

// Delimited continuation tests
test('shift is a singleton', () => {
  expect(Shift.get()).toBe(Shift.get())
})

test('shift toString', () => {
  expect(Shift.get().toString()).toBe('shift')
})

test('isShift works on shift only', () => {
  expect(isShift(Shift.get())).toBe(true)
  expect(isShift(1)).toBe(false)
  expect(isShift(Call_cc.get())).toBe(false)
})

test('reset is a singleton', () => {
  expect(Reset.get()).toBe(Reset.get())
})

test('reset toString', () => {
  expect(Reset.get().toString()).toBe('reset')
})

test('isReset works on reset only', () => {
  expect(isReset(Reset.get())).toBe(true)
  expect(isReset(1)).toBe(false)
  expect(isReset(Shift.get())).toBe(false)
})

test('DelimitedContinuation toString', () => {
  const context = mockContext()
  const cont = new DelimitedContinuation(
    context,
    [],
    [],
    context.runtime.environments,
  )
  expect(cont.toString()).toBe('delimited_continuation')
})

test('DelimitedContinuation returns copies of internal state', () => {
  const context = mockContext()
  const control = [{ type: 'Identifier', name: 'x' }]
  const stash = [1, 2, 3]
  const cont = new DelimitedContinuation(
    context,
    control as any,
    stash,
    context.runtime.environments,
  )

  // Verify returned arrays are copies
  const returnedControl = cont.getControl()
  const returnedStash = cont.getStash()

  expect(returnedControl).toEqual(control)
  expect(returnedStash).toEqual(stash)

  // Modifying returned arrays shouldn't affect the continuation
  returnedControl.push({ type: 'Literal', value: 5 } as any)
  returnedStash.push(4)

  expect(cont.getControl()).toEqual(control)
  expect(cont.getStash()).toEqual(stash)
})

// Effect handler tests
test('withHandle is a singleton', () => {
  expect(WithHandle.get()).toBe(WithHandle.get())
})

test('withHandle toString', () => {
  expect(WithHandle.get().toString()).toBe('withHandle')
})

test('isWithHandle works on withHandle only', () => {
  expect(isWithHandle(WithHandle.get())).toBe(true)
  expect(isWithHandle(1)).toBe(false)
  expect(isWithHandle(Shift.get())).toBe(false)
})

test('perform is a singleton', () => {
  expect(Perform.get()).toBe(Perform.get())
})

test('perform toString', () => {
  expect(Perform.get().toString()).toBe('perform')
})

test('isPerform works on perform only', () => {
  expect(isPerform(Perform.get())).toBe(true)
  expect(isPerform(1)).toBe(false)
  expect(isPerform(WithHandle.get())).toBe(false)
})
