import { Chapter, Variant } from '../../types'
import { expectFinishedResult, expectParsedError } from '../../utils/testing'

// Delimited continuation tests for ECE machine
const optionEC = { chapter: Chapter.SOURCE_4, variant: Variant.EXPLICIT_CONTROL }
// Use DELIM_CONT chapter for effect handlers (supports object expressions)
const optionDelimCont = { chapter: Chapter.DELIM_CONT, variant: Variant.EXPLICIT_CONTROL }

// ============================================================
// dc1.js: basic reset
// ============================================================
test('dc1: reset(() => 1 + 2 * 3) === 7', () => {
  return expectFinishedResult(
    `
    reset(() => 1 + 2 * 3);
    `,
    optionEC
  ).toMatchInlineSnapshot(`7`)
})

// ============================================================
// dc2.js: classic shift/reset
// ============================================================
test('dc2: 1 + reset(() => 2 * shift(k => k(3) + k(5))) === 17', () => {
  return expectFinishedResult(
    `
    1 + reset(() => 2 * shift(k => k(3) + k(5)));
    `,
    optionEC
  ).toMatchInlineSnapshot(`17`)
})

// ============================================================
// dc3.js: mutation and shift with variable capture
// ============================================================
test('dc3: mutation and shift with variable capture', () => {
  return expectFinishedResult(
    `
    let a = 0;
    let b = 0;
    let c = 0;
    reset(() => {
        a = 1;
        shift(k => {
            let d = 105;
            a = 2;
            c = k(100);
            return 3;
        }) + 5;
        b = 4;
    });
    `,
    optionEC
  ).toMatchInlineSnapshot(`3`)
})

// ============================================================
// dc4.js: currying via delimited continuations
// OCaml S4S returns [1, [2, [3, null]]] — the curry_c function
// builds a pair list of the arguments via shift/reset.
// ============================================================
test('dc4: currying via delimited continuations', () => {
  return expectFinishedResult(
    `
    function curry_c(f, arity) {
        function visit(i) {
            if (i === 0) {
                return null;
            } else {
                return pair(shift(k => x => reset(() => k(x))),
                            visit(i - 1));
            }
        }
        return reset(() => visit(arity));
    }
    curry_c((x, y, z) => (x + y + z), 3)(1)(2)(3);
    `,
    optionEC
  ).toMatchInlineSnapshot(`
    Array [
      1,
      Array [
        2,
        Array [
          3,
          null,
        ],
      ],
    ]
  `)
})

// ============================================================
// dc5.js: call/cc via shift
// ============================================================
test('dc5: call/cc implemented via shift', () => {
  return expectFinishedResult(
    `
    function my_call_cc(f) {
        return shift(f);
    }
    my_call_cc(k => k(3)) + 2;
    `,
    optionEC
  ).toMatchInlineSnapshot(`5`)
})

// ============================================================
// dc6.js: list prepend with shift (building continuation closures)
// ============================================================
test('dc6: list prepend with shift', () => {
  return expectFinishedResult(
    `
    let ks = null;

    function prepend(n) {
        if (n === 0) {
            return shift(k => xs => k(xs));
        } else {
            return pair(n, prepend(n - 1));
        }
    }

    function my_map(f, xs) {
        if (is_null(xs)) {
            return null;
        } else {
            return pair(f(head(xs)), my_map(f, tail(xs)));
        }
    }

    ks = pair(reset(() => prepend(1)), ks);
    ks = pair(reset(() => prepend(2)), ks);
    ks = pair(reset(() => prepend(3)), ks);
    ks = pair(reset(() => prepend(4)), ks);
    ks = pair(reset(() => prepend(5)), ks);

    my_map(k => k(null), ks);
    `,
    optionEC
  ).toBeDefined()
})

// ============================================================
// dc7.js: prepend_index with shift
// ============================================================
test('dc7: prepend_index with shift', () => {
  return expectFinishedResult(
    `
    function prepend_index(xs, i) {
        if (i === 0) {
            return shift(k => pair(head(xs), k(tail(xs))));
        } else {
            return pair(head(xs), prepend_index(tail(xs), i - 1));
        }
    }
    reset(() => prepend_index(list(0, 1, 2, 3, 4, 5, 6, 7, 8, 9), 5));
    `,
    optionEC
  ).toBeDefined()
})

// ============================================================
// dc8.js: multi-shift with mutation
// Note: Source blocks require explicit return for value-producing
// expressions. The OCaml S4S evaluator implicitly returns the
// last expression, but Source §4 does not.
// ============================================================
test('dc8: multi-shift with mutation', () => {
  return expectFinishedResult(
    `
    reset(() => {
        let x = shift(k => (k(1) === 16));
        x = x + 1;
        let y = shift(k => (k(x) * k(x)));
        return (y * y);
    });
    `,
    optionEC
  ).toMatchInlineSnapshot(`true`)
})

// ============================================================
// effect1.js: basic handler returning value
// ============================================================
test('effect1: basic handler with perform', () => {
  return expectFinishedResult(
    `
    withHandle(
      { test: (k) => k(41) },
      () => perform("test") + 1
    );
    `,
    optionDelimCont
  ).toMatchInlineSnapshot(`42`)
})

// ============================================================
// effect2.js: stateful handler (get/set/ret)
// ============================================================
test('effect2: stateful handler (get/set/ret)', () => {
  return expectFinishedResult(
    `
    withHandle(
      {
        get: (k) => s => k(s)(s),
        set: (k, v) => s => k(undefined)(v),
        ret: (k, v) => s => v
      },
      () => {
        perform("set", 2);
        perform("set", perform("get") + 1);
        perform("set", perform("get") + 1);
        perform("set", perform("get") + 1);
        return perform("ret", perform("get"));
      }
    )(0);
    `,
    optionDelimCont
  ).toMatchInlineSnapshot(`5`)
})

// ============================================================
// effect3.js: decide handler (maximize)
// ============================================================
test('effect3: decide handler (maximize)', () => {
  return expectFinishedResult(
    `
    function choose(x, y) {
        let b = perform("decide");
        return b ? x : y;
    }

    withHandle(
      {
        decide: (k) => {
          let x_t = k(true);
          let x_f = k(false);
          return x_t > x_f ? x_t : x_f;
        }
      },
      () => {
        let x1 = choose(15, 30);
        let x2 = choose(5, 10);
        return x1 - x2;
      }
    );
    `,
    optionDelimCont
  ).toMatchInlineSnapshot(`25`)
})

// ============================================================
// effect4.js: error handler (raise discards continuation)
// ============================================================
test('effect4: error handler (raise discards continuation)', () => {
  return expectFinishedResult(
    `
    function divide(x, y) {
        if (y === 0) {
            perform("raise", "division by zero");
        } else {
            return (x / y);
        }
    }

    withHandle(
      { raise: (k, msg) => display(msg) },
      () => {
        let x1 = divide(10, 2);
        let x2 = divide(10, 0);
        let x3 = divide(10, 5);
        return x1 + x2 + x3;
      }
    );
    `,
    optionDelimCont
  ).toMatchInlineSnapshot(`"division by zero"`)
})

// ============================================================
// effect5.js: pythagorean triples via backtracking
// ============================================================
test('effect5: pythagorean triples via backtracking', () => {
  return expectFinishedResult(
  `
    function chooseInt(m, n) {
        if (m > n) {
            perform("fail");
        } else {
            let b = perform("decide");
            if (b) {
                return m;
            } else {
                return chooseInt(m + 1, n);
            }
        }
    }

    function isSquare(x) {
        let s = math_round(math_sqrt(x));
        return s * s === x;
    }

    function pythagorean(m, n) {
        let a = chooseInt(m, n - 1);
        let b = chooseInt(a + 1, n);
        if (isSquare(a * a + b * b)) {
            return list(a, b, math_sqrt(a * a + b * b));
        } else {
            perform("fail");
        }
    }

    withHandle(
      {
        decide: (k) => {
          const failure_handler = {
            fail: (k_useless) => k(false)
          };
          return withHandle(failure_handler, () => k(true));
        }
      },
      () => pythagorean(14, 20)
    );
    `,
  optionDelimCont
).toMatchInlineSnapshot(`
Array [
  15,
  Array [
    20,
    Array [
      25,
      null,
    ],
  ],
]
`)
})

// ============================================================
// effect6.js: handler discards continuation, returns computed value
// ============================================================
test('effect6: handler discards continuation, returns computed value', () => {
  return expectFinishedResult(
    `
    withHandle(
      { test: (k, a, b) => a / b },
      () => perform("test", 0, 2)
    );
    `,
    optionDelimCont
  ).toMatchInlineSnapshot(`0`)
})

// ============================================================
// effect7.js: multi-shot handler
// ============================================================
test('effect7: multi-shot handler continuation', () => {
  return expectFinishedResult(
    `
    1 + withHandle(
      { test: (k) => k(3) + k(5) },
      () => 2 * perform("test")
    );
    `,
    optionDelimCont
  ).toMatchInlineSnapshot(`17`)
})

// ============================================================
// effect8.js: fibonacci via accumulate effect
// ============================================================
test('effect8: fibonacci via accumulate effect', () => {
  return expectFinishedResult(
  `
    withHandle(
      {
        produce: (k, val) => {
          if (val < 100) {
            return pair(val, k(null));
          } else {
            return null;
          }
        }
      },
      () => {
        let a = 0;
        let b = 1;
        function generate() {
            b = a + b;
            a = b - a;
            perform("produce", a);
            generate();
        }
        generate();
      }
    );
    `,
  optionDelimCont
).toMatchInlineSnapshot(`
Array [
  1,
  Array [
    1,
    Array [
      2,
      Array [
        3,
        Array [
          5,
          Array [
            8,
            Array [
              13,
              Array [
                21,
                Array [
                  34,
                  Array [
                    55,
                    Array [
                      89,
                      null,
                    ],
                  ],
                ],
              ],
            ],
          ],
        ],
      ],
    ],
  ],
]
`)
})

// ============================================================
// Additional basic tests
// ============================================================
test('basic reset returns value from thunk', () => {
  return expectFinishedResult(
    `
    reset(() => 42);
    `,
    optionEC
  ).toMatchInlineSnapshot(`42`)
})

test('shift can discard continuation', () => {
  return expectFinishedResult(
    `
    reset(() => 1 + shift(k => 42));
    `,
    optionEC
  ).toMatchInlineSnapshot(`42`)
})

test('shift can access values from outer scope', () => {
  return expectFinishedResult(
    `
    const x = 10;
    reset(() => x + shift(k => k(5)));
    `,
    optionEC
  ).toMatchInlineSnapshot(`15`)
})

test('shift outside reset captures full control', () => {
  return expectFinishedResult(
    `
    shift(k => 42);
    `,
    optionEC
  ).toMatchInlineSnapshot(`42`)
})

test('basic withHandle returns value from body', () => {
  return expectFinishedResult(
    `
    withHandle({}, () => 42);
    `,
    optionDelimCont
  ).toMatchInlineSnapshot(`42`)
})

test('nested handlers with different operations', () => {
  return expectFinishedResult(
    `
    withHandle(
      { outer: (k, x) => k(x + 100) },
      () => withHandle(
        { inner: (k, x) => k(x * 2) },
        () => perform("outer", 5) + perform("inner", 3)
      )
    );
    `,
    optionDelimCont
  ).toMatchInlineSnapshot(`111`)
})

test('handler continuation can be called multiple times', () => {
  return expectFinishedResult(
    `
    withHandle(
      { choose: (k) => k(true) + k(false) },
      () => perform("choose") ? 10 : 1
    );
    `,
    optionDelimCont
  ).toMatchInlineSnapshot(`11`)
})

// ============================================================
// scheduler: cooperative multithreading via effect handlers
// ============================================================
test('scheduler: cooperative multithreading', () => {
  return expectFinishedResult(
    `
    let q = null;

    function enqueue(t) {
        const new_item = pair(t, null);
        if (is_null(q)) {
            q = new_item;
        } else {
            let curr = q;
            while (!is_null(tail(curr))) {
                curr = tail(curr);
            }
            set_tail(curr, new_item);
        }
    }

    function dequeue() {
        if (!is_null(q)) {
            const t = head(q);
            q = tail(q);
            t(undefined);
        }
    }

    function run(main) {
        withHandle(
            {
                async: (k, f) => {
                    enqueue(k);
                    run(f);
                },
                yield: (k) => {
                    enqueue(k);
                    dequeue();
                }
            },
            () => {
                main();
                dequeue();
            }
        );
    }

    let log = null;
    function log_msg(msg) {
        if (is_null(log)) {
            log = pair(msg, null);
        } else {
            let curr = log;
            while (!is_null(tail(curr))) {
                curr = tail(curr);
            }
            set_tail(curr, pair(msg, null));
        }
    }

    function main() {
        function mk_task(name) {
            return () => {
                log_msg("starting " + name);
                perform("yield");
                log_msg("ending " + name);
            };
        }
        perform("async", mk_task("a"));
        perform("async", mk_task("b"));
    }

    run(main);
    log;
    `,
    optionDelimCont
  ).toMatchInlineSnapshot(`
Array [
  "starting a",
  Array [
    "starting b",
    Array [
      "ending a",
      Array [
        "ending b",
        null,
      ],
    ],
  ],
]
`)
})

// Error cases
test('perform without handler throws error', () => {
  return expectParsedError(
    `
    perform("unknown", 5);
    `,
    optionDelimCont
  ).toMatchInlineSnapshot(`"Error: No handler found for operation: unknown"`)
})
