import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  Copy,
  HelpCircle,
  Lock,
  Play,
  RotateCcw,
  Sparkles,
  Terminal,
  Undo2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Python value model                                                  */
/* ------------------------------------------------------------------ */

let _uid = 0;

const uid = () => ++_uid;

function parseRaw(raw) {
  const text = String(raw).trim();

  if (text === "True") {
    return {
      kind: "bool",
      value: true,
    };
  }

  if (text === "False") {
    return {
      kind: "bool",
      value: false,
    };
  }

  if (text === "None") {
    return {
      kind: "none",
      value: null,
    };
  }

  if (/^-?\d+$/.test(text)) {
    return {
      kind: "int",
      value: parseInt(text, 10),
    };
  }

  if (/^-?(\d+\.\d*|\.\d+)$/.test(text)) {
    return {
      kind: "float",
      value: parseFloat(text),
    };
  }

  const quoted = text.match(/^'(.*)'$|^"(.*)"$/);

  if (quoted) {
    return {
      kind: "str",
      value: quoted[1] !== undefined ? quoted[1] : quoted[2],
    };
  }

  return {
    kind: "str",
    value: text,
  };
}

function repr(value) {
  switch (value.kind) {
    case "str":
      return `'${String(value.value)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")}'`;

    case "bool":
      return value.value ? "True" : "False";

    case "none":
      return "None";

    default:
      return String(value.value);
  }
}

function itemRepr(item) {
  return repr(parseRaw(item.raw));
}

function tupleRepr(items) {
  if (items.length === 0) {
    return "()";
  }

  if (items.length === 1) {
    return `(${itemRepr(items[0])},)`;
  }

  return `(${items.map(itemRepr).join(", ")})`;
}

function isNumberLike(value) {
  return (
    value.kind === "int" ||
    value.kind === "float" ||
    value.kind === "bool"
  );
}

function numericValue(value) {
  if (value.kind === "bool") {
    return value.value ? 1 : 0;
  }

  return value.value;
}

function sameValue(first, second) {
  if (first.kind === second.kind) {
    return first.value === second.value;
  }

  if (isNumberLike(first) && isNumberLike(second)) {
    return numericValue(first) === numericValue(second);
  }

  return false;
}

class PyError extends Error {
  constructor(name, message) {
    super(`${name}: ${message}`);
    this.pyName = name;
  }
}

function requireInt(text, label = "index") {
  const value = String(text).trim();

  if (value === "") {
    throw new PyError("TypeError", `${label} is required`);
  }

  if (!/^-?\d+$/.test(value)) {
    throw new PyError(
      "TypeError",
      "tuple indices must be integers or slices, not str"
    );
  }

  return parseInt(value, 10);
}

function optionalInt(text) {
  const value = String(text).trim();

  if (value === "") {
    return null;
  }

  if (!/^-?\d+$/.test(value)) {
    throw new PyError(
      "TypeError",
      "slice indices must be integers or None or have an __index__ method"
    );
  }

  return parseInt(value, 10);
}

function normalizeIndex(index, length) {
  const normalized = index < 0 ? index + length : index;

  if (normalized < 0 || normalized >= length) {
    throw new PyError("IndexError", "tuple index out of range");
  }

  return normalized;
}

function pythonSlice(items, start, stop, step) {
  const actualStep = step === null ? 1 : step;

  if (actualStep === 0) {
    throw new PyError("ValueError", "slice step cannot be zero");
  }

  const length = items.length;
  const picked = [];

  if (actualStep > 0) {
    const normalize = (value, defaultValue) => {
      if (value === null) {
        return defaultValue;
      }

      const normalized = value < 0 ? value + length : value;

      return Math.min(Math.max(normalized, 0), length);
    };

    const first = normalize(start, 0);
    const last = normalize(stop, length);

    for (
      let index = first;
      index < last;
      index += actualStep
    ) {
      picked.push(index);
    }

    return picked;
  }

  const normalize = (value, defaultValue) => {
    if (value === null) {
      return defaultValue;
    }

    const normalized = value < 0 ? value + length : value;

    return Math.min(Math.max(normalized, -1), length - 1);
  };

  const first = normalize(start, length - 1);
  const last = normalize(stop, -1);

  for (
    let index = first;
    index > last;
    index += actualStep
  ) {
    picked.push(index);
  }

  return picked;
}

function splitTupleValues(text) {
  const source = String(text).trim();

  if (source === "") {
    return [];
  }

  const values = [];

  let current = "";
  let quote = null;
  let escaped = false;

  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }

    if (quote) {
      current += character;

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }

    if (character === ",") {
      if (current.trim() !== "") {
        values.push(current.trim());
      }

      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim() !== "") {
    values.push(current.trim());
  }

  return values;
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

const PRESETS = [
  {
    id: "numbers",
    label: "Numbers",
    name: "original",
    raws: ["3", "1", "4", "1", "5", "9"],
  },
  {
    id: "fruits",
    label: "Fruits",
    name: "original",
    raws: ["apple", "banana", "cherry", "date"],
  },
  {
    id: "mixed",
    label: "Mixed types",
    name: "original",
    raws: ["7", "hello", "2.5", "True"],
  },
  {
    id: "single",
    label: "Singleton",
    name: "original",
    raws: ["hello"],
  },
  {
    id: "empty",
    label: "Empty",
    name: "original",
    raws: [],
  },
];

function makeItems(raws) {
  return raws.map((raw) => ({
    id: uid(),
    raw,
  }));
}

/* ------------------------------------------------------------------ */
/* Small UI components                                                 */
/* ------------------------------------------------------------------ */

function Tip({ text }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={text}
        className="rounded-full text-slate-400 transition-colors hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <HelpCircle className="h-4 w-4" />
      </button>

      <span className="pointer-events-none absolute left-1/2 top-6 z-40 hidden w-64 -translate-x-1/2 rounded-lg bg-slate-900 p-2.5 text-xs font-normal leading-relaxed text-slate-100 shadow-lg group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

function Field({
  value,
  onChange,
  placeholder,
  width = "w-16",
  label,
}) {
  return (
    <input
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={`${width} rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200`}
    />
  );
}

function RunButton({
  onClick,
  label,
  text = "Run",
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="ml-auto inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <Play className="h-3 w-3" />
      {text}
    </button>
  );
}

function OperationCard({
  title,
  tip,
  children,
  accent = false,
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        accent
          ? "border-amber-200 bg-amber-50/50"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="mb-2 flex items-center gap-1.5">
        {accent && (
          <Lock className="h-3.5 w-3.5 text-amber-600" />
        )}

        <h3 className="font-mono text-sm font-semibold tracking-tight text-slate-900">
          {title}
        </h3>

        <Tip text={tip} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {children}
      </div>
    </div>
  );
}

function LearningBuddy({ buddy }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-violet-100 bg-violet-50 px-3 py-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-xl shadow-sm">
        {buddy.avatar}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" />

          <p className="text-xs font-bold uppercase tracking-wider text-violet-700">
            {buddy.name}
          </p>
        </div>

        <p className="mt-1 text-sm leading-relaxed text-slate-700">
          {buddy.message}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main playground                                                     */
/* ------------------------------------------------------------------ */

export default function PythonTuplesPlayground() {
  const [preset, setPreset] = useState(PRESETS[0]);

  const [name, setName] = useState(PRESETS[0].name);

  const [items, setItems] = useState(() =>
    makeItems(PRESETS[0].raws)
  );

  const [derivedTuple, setDerivedTuple] = useState(null);

  const [log, setLog] = useState(() => {
    const initialItems = makeItems(PRESETS[0].raws);

    return [
      {
        id: uid(),
        type: "note",
        text: "Python 3.12 — tuples are ordered, indexed, and immutable.",
      },
      {
        id: uid(),
        type: "in",
        text: `${PRESETS[0].name} = ${tupleRepr(initialItems)}`,
      },
    ];
  });

  const [code, setCode] = useState(() => {
    const initialItems = makeItems(PRESETS[0].raws);

    return [
      {
        id: uid(),
        kind: "assign",
        text: `${PRESETS[0].name} = ${tupleRepr(initialItems)}`,
      },
    ];
  });

  const [history, setHistory] = useState([]);

  const [highlight, setHighlight] = useState(null);

  const [copied, setCopied] = useState(false);

  const [buddy, setBuddy] = useState({
    avatar: "👨‍🏫",
    name: "Professor Mohammad",
    message:
      "Hi! Start with original[0]. Watch the matching tuple cell light up.",
  });

  const [args, setArgs] = useState({
    index: "0",
    start: "1",
    stop: "4",
    step: "",
    countVal: "1",
    findVal: "1",
    memberVal: "4",
    mutateIndex: "0",
    mutateVal: "99",
    newTupleVal: "8",
    concatVals: "6, 2",
    repeatCount: "2",
  });

  const consoleRef = useRef(null);

  const flashTimer = useRef(null);

  const numberOfItems = items.length;

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop =
        consoleRef.current.scrollHeight;
    }
  }, [log]);

  useEffect(() => {
    return () => {
      clearTimeout(flashTimer.current);
    };
  }, []);

  function setArg(key, value) {
    setArgs((current) => ({
      ...current,
      [key]: value,
    }));
  }

  const snapshot = useCallback(() => {
    setHistory((current) => [
      ...current.slice(-59),
      {
        items,
        log,
        code,
        name,
        preset,
        derivedTuple,
        buddy,
      },
    ]);
  }, [
    items,
    log,
    code,
    name,
    preset,
    derivedTuple,
    buddy,
  ]);

  function flash(indices, tone = "hit") {
    clearTimeout(flashTimer.current);

    setHighlight({
      indices: new Set(indices),
      tone,
    });

    flashTimer.current = setTimeout(() => {
      setHighlight(null);
    }, 3000);
  }

  function emit(lines, codeLines) {
    setLog((current) => [
      ...current,
      ...lines.map((line) => ({
        id: uid(),
        ...line,
      })),
    ]);

    if (codeLines?.length) {
      setCode((current) => [
        ...current,
        ...codeLines.map((text) => ({
          id: uid(),
          kind: "operation",
          text,
        })),
      ]);
    }
  }

  function runExpression(
    expression,
    operation,
    successBuddy
  ) {
    let result;

    try {
      result = operation();
    } catch (error) {
      snapshot();

      emit(
        [
          {
            type: "in",
            text: expression,
          },
          {
            type: "err",
            text:
              error instanceof PyError
                ? error.message
                : String(error),
          },
        ],
        [expression]
      );

      setBuddy({
        avatar: "🤖",
        name: "Byte",
        message:
          "Errors are useful clues. Try changing the input and see what Python accepts.",
      });

      return;
    }

    snapshot();

    const lines = [
      {
        type: "in",
        text: expression,
      },
    ];

    if (result.out !== undefined) {
      lines.push({
        type: "out",
        text: result.out,
      });
    }

    emit(
      lines,
      result.out !== undefined
        ? [`print(${expression})  # ${result.out}`]
        : [expression]
    );

    flash(
      result.touch || [],
      result.tone
    );

    if (successBuddy) {
      setBuddy(successBuddy);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Reading                                                           */
  /* ---------------------------------------------------------------- */

  function doIndex() {
    const raw = args.index.trim();

    const expression = `${name}[${raw}]`;

    runExpression(
      expression,
      () => {
        const index = requireInt(args.index);

        const normalized = normalizeIndex(
          index,
          items.length
        );

        return {
          out: itemRepr(items[normalized]),
          touch: [normalized],
        };
      },
      {
        avatar: "👨‍🏫",
        name: "Professor Mohammad",
        message:
          "Nice! Indexing reads one value without changing the tuple. Try -1 next to jump to the last item.",
      }
    );
  }

  function doSlice() {
    const parts = [
      args.start.trim(),
      args.stop.trim(),
      args.step.trim(),
    ];

    const slice =
      parts[2] === ""
        ? `${parts[0]}:${parts[1]}`
        : `${parts[0]}:${parts[1]}:${parts[2]}`;

    runExpression(
      `${name}[${slice}]`,
      () => {
        const picked = pythonSlice(
          items,
          optionalInt(args.start),
          optionalInt(args.stop),
          optionalInt(args.step)
        );

        const slicedItems = picked.map(
          (index) => items[index]
        );

        return {
          out: tupleRepr(slicedItems),
          touch: picked,
        };
      },
      {
        avatar: "🦊",
        name: "Mimi",
        message:
          "Great slice! The highlighted cells were read from the original, and Python returned a new tuple.",
      }
    );
  }

  function doCount() {
    const raw = args.countVal.trim();

    if (raw === "") {
      runExpression(
        `${name}.count()`,
        () => {
          throw new PyError(
            "TypeError",
            "tuple.count() takes exactly one argument (0 given)"
          );
        }
      );

      return;
    }

    const value = parseRaw(raw);

    runExpression(
      `${name}.count(${repr(value)})`,
      () => {
        const matches = items
          .map((item, index) => ({
            item,
            index,
          }))
          .filter(({ item }) =>
            sameValue(
              parseRaw(item.raw),
              value
            )
          );

        return {
          out: String(matches.length),
          touch: matches.map(
            ({ index }) => index
          ),
        };
      },
      {
        avatar: "🐣",
        name: "Dot",
        message:
          "You found every matching value! count() only observes the tuple — it never changes it.",
      }
    );
  }

  function doFindIndex() {
    const raw = args.findVal.trim();

    if (raw === "") {
      runExpression(
        `${name}.index()`,
        () => {
          throw new PyError(
            "TypeError",
            "tuple.index() takes at least 1 argument (0 given)"
          );
        }
      );

      return;
    }

    const value = parseRaw(raw);

    runExpression(
      `${name}.index(${repr(value)})`,
      () => {
        const foundIndex = items.findIndex(
          (item) =>
            sameValue(
              parseRaw(item.raw),
              value
            )
        );

        if (foundIndex === -1) {
          throw new PyError(
            "ValueError",
            "tuple.index(x): x not in tuple"
          );
        }

        return {
          out: String(foundIndex),
          touch: [foundIndex],
        };
      },
      {
        avatar: "🦊",
        name: "Mimi",
        message:
          "Exactly! index() returns the position of the first matching value.",
      }
    );
  }

  function doMembership() {
    const raw = args.memberVal.trim();

    const value =
      raw === ""
        ? {
            kind: "str",
            value: "",
          }
        : parseRaw(raw);

    runExpression(
      `${repr(value)} in ${name}`,
      () => {
        const matches = items
          .map((item, index) => ({
            item,
            index,
          }))
          .filter(({ item }) =>
            sameValue(
              parseRaw(item.raw),
              value
            )
          )
          .map(({ index }) => index);

        return {
          out:
            matches.length > 0
              ? "True"
              : "False",
          touch: matches,
        };
      },
      {
        avatar: "👨‍🏫",
        name: "Professor Mohammad",
        message:
          "Nice check! The in operator answers a simple question: is this value somewhere inside the tuple?",
      }
    );
  }

  /* ---------------------------------------------------------------- */
  /* Immutability                                                      */
  /* ---------------------------------------------------------------- */

  function doMutationAttempt() {
    const indexText = args.mutateIndex.trim();

    const valueText = args.mutateVal.trim();

    const shownValue =
      valueText === ""
        ? "?"
        : repr(parseRaw(valueText));

    const expression =
      `${name}[${indexText}] = ${shownValue}`;

    try {
      const index = requireInt(
        args.mutateIndex
      );

      normalizeIndex(
        index,
        items.length
      );

      if (valueText === "") {
        throw new PyError(
          "SyntaxError",
          "invalid syntax"
        );
      }

      throw new PyError(
        "TypeError",
        "'tuple' object does not support item assignment"
      );
    } catch (error) {
      snapshot();

      emit(
        [
          {
            type: "in",
            text: expression,
          },
          {
            type: "err",
            text:
              error instanceof PyError
                ? error.message
                : String(error),
          },
          {
            type: "note",
            text: `${name} is still ${tupleRepr(items)}`,
          },
        ],
        [expression]
      );

      setBuddy({
        avatar: "🤖",
        name: "Byte",
        message:
          "Perfect! That error is the lesson. Python protected the tuple, so the original values stayed exactly the same.",
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* New tuple                                                         */
  /* ---------------------------------------------------------------- */

  function doCreateWithItem() {
    const raw = args.newTupleVal.trim();

    if (raw === "") {
      setBuddy({
        avatar: "🐣",
        name: "Dot",
        message:
          "Give the new tuple an extra value first, then press Create.",
      });

      return;
    }

    snapshot();

    const addedItem = {
      id: uid(),
      raw,
    };

    const oneItemTuple = tupleRepr([
      addedItem,
    ]);

    const nextItems = [
      ...items.map((item) => ({
        id: uid(),
        raw: item.raw,
      })),
      {
        id: uid(),
        raw,
      },
    ];

    const expression =
      `new_tuple = ${name} + ${oneItemTuple}`;

    const resultText =
      tupleRepr(nextItems);

    setDerivedTuple({
      name: "new_tuple",
      items: nextItems,
    });

    setLog((current) => [
      ...current,
      {
        id: uid(),
        type: "in",
        text: expression,
      },
      {
        id: uid(),
        type: "in",
        text: name,
      },
      {
        id: uid(),
        type: "out",
        text: tupleRepr(items),
      },
      {
        id: uid(),
        type: "in",
        text: "new_tuple",
      },
      {
        id: uid(),
        type: "out",
        text: resultText,
      },
      {
        id: uid(),
        type: "note",
        text: `${name} did not change.`,
      },
    ]);

    setCode((current) => [
      ...current,
      {
        id: uid(),
        kind: "operation",
        text: expression,
      },
      {
        id: uid(),
        kind: "operation",
        text: `print(${name})  # ${tupleRepr(items)}`,
      },
      {
        id: uid(),
        kind: "operation",
        text: `print(new_tuple)  # ${resultText}`,
      },
    ]);

    flash(
      items.map((_, index) => index),
      "soft"
    );

    setBuddy({
      avatar: "🐣",
      name: "Dot",
      message:
        "You got it! original stayed locked. Python built a different tuple and stored it in new_tuple.",
    });
  }

  function doConcat() {
    const raws = splitTupleValues(
      args.concatVals
    );

    const otherItems =
      makeItems(raws);

    const otherTuple =
      tupleRepr(otherItems);

    runExpression(
      `${name} + ${otherTuple}`,
      () => {
        const combined = [
          ...items.map((item) => ({
            id: uid(),
            raw: item.raw,
          })),
          ...otherItems,
        ];

        return {
          out: tupleRepr(combined),
          touch: items.map(
            (_, index) => index
          ),
          tone: "soft",
        };
      },
      {
        avatar: "🦊",
        name: "Mimi",
        message:
          "Nice! + combines tuples by creating a new result. The original tuple is still untouched.",
      }
    );
  }

  function doRepeat() {
    const countText =
      args.repeatCount.trim();

    runExpression(
      `${name} * ${countText}`,
      () => {
        if (!/^-?\d+$/.test(countText)) {
          throw new PyError(
            "TypeError",
            "can't multiply sequence by non-int of type 'str'"
          );
        }

        const count = parseInt(
          countText,
          10
        );

        const repeated = [];

        for (
          let iteration = 0;
          iteration < Math.max(0, count);
          iteration++
        ) {
          repeated.push(
            ...items.map((item) => ({
              id: uid(),
              raw: item.raw,
            }))
          );
        }

        return {
          out: tupleRepr(repeated),
          touch: items.map(
            (_, index) => index
          ),
          tone: "soft",
        };
      },
      {
        avatar: "👨‍🏫",
        name: "Professor Mohammad",
        message:
          "Great! Multiplication repeats the values into a new tuple. It still doesn't modify original.",
      }
    );
  }

  /* ---------------------------------------------------------------- */
  /* Presets and history                                               */
  /* ---------------------------------------------------------------- */

  function loadPreset(nextPreset) {
    snapshot();

    const nextItems =
      makeItems(nextPreset.raws);

    setPreset(nextPreset);

    setName(nextPreset.name);

    setItems(nextItems);

    setDerivedTuple(null);

    setCode([
      {
        id: uid(),
        kind: "assign",
        text: `${nextPreset.name} = ${tupleRepr(nextItems)}`,
      },
    ]);

    setLog([
      {
        id: uid(),
        type: "note",
        text: `Loaded the ${nextPreset.label.toLowerCase()} tuple.`,
      },
      {
        id: uid(),
        type: "in",
        text: `${nextPreset.name} = ${tupleRepr(nextItems)}`,
      },
    ]);

    setHighlight(null);

    setBuddy({
      avatar: "👨‍🏫",
      name: "Professor Mohammad",
      message:
        "Fresh tuple loaded! Try reading one of its values with an index.",
    });
  }

  function undo() {
    setHistory((current) => {
      if (!current.length) {
        return current;
      }

      const previous =
        current[current.length - 1];

      setItems(previous.items);

      setLog(previous.log);

      setCode(previous.code);

      setName(previous.name);

      setPreset(previous.preset);

      setDerivedTuple(
        previous.derivedTuple
      );

      setBuddy(previous.buddy);

      setHighlight(null);

      return current.slice(0, -1);
    });
  }

  function reset() {
    loadPreset(preset);
  }

  /* ---------------------------------------------------------------- */
  /* Copy source                                                       */
  /* ---------------------------------------------------------------- */

  const codeText = useMemo(
    () =>
      code
        .map((line) => line.text)
        .join("\n"),
    [code]
  );

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(
        codeText
      );
    } catch {
      const textarea =
        document.createElement(
          "textarea"
        );

      textarea.value = codeText;

      document.body.appendChild(
        textarea
      );

      textarea.select();

      try {
        document.execCommand("copy");
      } catch {
        // Clipboard may be unavailable in restricted environments.
      }

      document.body.removeChild(
        textarea
      );
    }

    setCopied(true);

    setTimeout(() => {
      setCopied(false);
    }, 1500);
  }

  return (
    <div className="min-h-screen w-full bg-slate-100 p-4 text-slate-900 sm:p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}

        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-indigo-600">
              Interactive reference
            </p>

            <h1 className="mt-1 font-mono text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              tuple
              <span className="text-indigo-600">
                (
              </span>
              playground
              <span className="text-indigo-600">
                )
              </span>
            </h1>

            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Explore how Python tuples
              work: read values, search
              them, create new tuples,
              and discover why the
              original tuple cannot be
              changed.
            </p>

            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-slate-500">
                Your study buddies:
              </span>

              <span
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm shadow-sm"
                title="Professor Mohammad"
              >
                👨‍🏫
              </span>

              <span
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm shadow-sm"
                title="Mimi"
              >
                🦊
              </span>

              <span
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm shadow-sm"
                title="Dot"
              >
                🐣
              </span>

              <span
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm shadow-sm"
                title="Byte"
              >
                🤖
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={undo}
              disabled={!history.length}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <Undo2 className="h-4 w-4" />
              Undo
            </button>

            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(370px,1fr)]">
          {/* Main learning area */}

          <main className="space-y-5">
            {/* Original tuple */}

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Starter tuples
                </span>

                {PRESETS.map(
                  (item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() =>
                        loadPreset(item)
                      }
                      className={`rounded-full px-3 py-1 font-mono text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                        preset.id === item.id
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {item.label}
                    </button>
                  )
                )}
              </div>

              <div className="rounded-lg bg-slate-50 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Original tuple
                    </p>

                    <div className="mt-1 flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900">
                        {name}
                      </span>

                      <span className="font-mono text-sm text-slate-400">
                        len() ={" "}
                        {numberOfItems}
                      </span>
                    </div>
                  </div>

                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-900">
                    <Lock className="h-3.5 w-3.5" />
                    Immutable — items
                    cannot change
                  </span>
                </div>

                <div className="mb-4 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2">
                  <p className="font-mono text-sm text-indigo-950">
                    {name} ={" "}
                    {tupleRepr(items)}
                  </p>
                </div>

                {numberOfItems === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 px-3 py-5 text-center">
                    <p className="font-mono text-sm text-slate-500">
                      ()
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      This is an empty
                      tuple.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start gap-2 pb-1">
                    {items.map(
                      (
                        item,
                        index
                      ) => {
                        const hit =
                          highlight?.indices.has(
                            index
                          );

                        return (
                          <div
                            key={
                              item.id
                            }
                            className="flex flex-col items-center"
                          >
                            <span
                              className={`mb-1 font-mono text-[11px] ${
                                hit
                                  ? "font-bold text-amber-600"
                                  : "text-slate-400"
                              }`}
                            >
                              {
                                index
                              }
                            </span>

                            <div
                              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 transition-all duration-300 ${
                                hit
                                  ? highlight.tone ===
                                    "soft"
                                    ? "scale-105 border-indigo-400 bg-indigo-100 shadow-sm"
                                    : "scale-105 border-amber-400 bg-amber-100 shadow-sm"
                                  : "border-slate-300 bg-white"
                              }`}
                            >
                              <Lock className="h-3 w-3 text-slate-300" />

                              <span className="font-mono text-sm text-slate-900">
                                {itemRepr(
                                  item
                                )}
                              </span>
                            </div>

                            <span
                              className={`mt-1 font-mono text-[11px] ${
                                hit
                                  ? "font-bold text-amber-600"
                                  : "text-slate-400"
                              }`}
                            >
                              {index -
                                numberOfItems}
                            </span>
                          </div>
                        );
                      }
                    )}
                  </div>
                )}

                <div className="mt-4 flex items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />

                  <p className="text-xs leading-relaxed text-slate-600">
                    There are no edit,
                    delete, or append
                    buttons here on
                    purpose. Once{" "}
                    <span className="font-mono font-semibold">
                      {name}
                    </span>{" "}
                    exists, its items
                    cannot be replaced,
                    removed, or appended.
                  </p>
                </div>

                {numberOfItems ===
                  1 && (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <strong>
                      Notice the comma:
                    </strong>{" "}
                    <span className="font-mono">
                      {tupleRepr(
                        items
                      )}
                    </span>
                    . A one-item tuple
                    needs a trailing
                    comma.
                  </div>
                )}
              </div>

              <div className="mt-4">
                <LearningBuddy
                  buddy={buddy}
                />
              </div>
            </section>

            {/* Read from tuple */}

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Read from the original
                tuple
              </h2>

              <p className="mb-3 text-sm text-slate-600">
                Immutable does not mean
                unusable. Try these
                operations and watch the
                matching cells above
                light up.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <OperationCard
                  title={`${name}[i]`}
                  tip="Indexing reads one item. Index 0 is the first item and -1 is the last."
                >
                  <Field
                    value={args.index}
                    onChange={(value) =>
                      setArg(
                        "index",
                        value
                      )
                    }
                    placeholder="i"
                    width="w-14"
                    label="Tuple index"
                  />

                  <RunButton
                    onClick={doIndex}
                    label="Run tuple indexing"
                  />
                </OperationCard>

                <OperationCard
                  title={`${name}[a:b:c]`}
                  tip="Slicing reads a range and returns another tuple. Start is included and stop is excluded."
                >
                  <Field
                    value={
                      args.start
                    }
                    onChange={(value) =>
                      setArg(
                        "start",
                        value
                      )
                    }
                    placeholder="start"
                    width="w-14"
                    label="Slice start"
                  />

                  <span className="font-mono text-slate-400">
                    :
                  </span>

                  <Field
                    value={args.stop}
                    onChange={(value) =>
                      setArg(
                        "stop",
                        value
                      )
                    }
                    placeholder="stop"
                    width="w-14"
                    label="Slice stop"
                  />

                  <span className="font-mono text-slate-400">
                    :
                  </span>

                  <Field
                    value={args.step}
                    onChange={(value) =>
                      setArg(
                        "step",
                        value
                      )
                    }
                    placeholder="step"
                    width="w-14"
                    label="Slice step"
                  />

                  <RunButton
                    onClick={doSlice}
                    label="Run tuple slicing"
                  />
                </OperationCard>

                <OperationCard
                  title=".count(x)"
                  tip="count(x) tells you how many items equal x. It reads the tuple without changing it."
                >
                  <Field
                    value={
                      args.countVal
                    }
                    onChange={(value) =>
                      setArg(
                        "countVal",
                        value
                      )
                    }
                    placeholder="value"
                    width="w-24"
                    label="Value to count"
                  />

                  <RunButton
                    onClick={doCount}
                    label="Run tuple count"
                  />
                </OperationCard>

                <OperationCard
                  title=".index(x)"
                  tip="index(x) returns the position of the first matching item. A missing item raises ValueError."
                >
                  <Field
                    value={
                      args.findVal
                    }
                    onChange={(value) =>
                      setArg(
                        "findVal",
                        value
                      )
                    }
                    placeholder="value"
                    width="w-24"
                    label="Value to find"
                  />

                  <RunButton
                    onClick={
                      doFindIndex
                    }
                    label="Run tuple index search"
                  />
                </OperationCard>

                <OperationCard
                  title={`x in ${name}`}
                  tip="The in operator checks whether a value appears anywhere in the tuple and returns True or False."
                >
                  <Field
                    value={
                      args.memberVal
                    }
                    onChange={(value) =>
                      setArg(
                        "memberVal",
                        value
                      )
                    }
                    placeholder="value"
                    width="w-24"
                    label="Membership value"
                  />

                  <RunButton
                    onClick={
                      doMembership
                    }
                    label="Run tuple membership test"
                  />
                </OperationCard>
              </div>
            </section>

            {/* Immutability experiment */}

            <section className="rounded-xl border border-amber-300 bg-white p-4 shadow-sm">
              <div className="mb-1 flex items-center gap-2">
                <Lock className="h-5 w-5 text-amber-600" />

                <h2 className="font-semibold text-slate-900">
                  Can we change the
                  original tuple?
                </h2>
              </div>

              <p className="mb-4 text-sm text-slate-600">
                Try replacing one item.
                This experiment is
                supposed to fail.
              </p>

              <OperationCard
                title={`${name}[i] = x`}
                tip="Lists allow item assignment, but tuples do not. Python raises TypeError when you try to replace an item inside a tuple."
                accent
              >
                <Field
                  value={
                    args.mutateIndex
                  }
                  onChange={(value) =>
                    setArg(
                      "mutateIndex",
                      value
                    )
                  }
                  placeholder="i"
                  width="w-14"
                  label="Item assignment index"
                />

                <span className="font-mono text-sm text-slate-400">
                  =
                </span>

                <Field
                  value={
                    args.mutateVal
                  }
                  onChange={(value) =>
                    setArg(
                      "mutateVal",
                      value
                    )
                  }
                  placeholder="value"
                  width="w-24"
                  label="New item value"
                />

                <RunButton
                  onClick={
                    doMutationAttempt
                  }
                  label="Try changing the tuple"
                  text="Try it"
                />

                <div className="w-full rounded-md bg-amber-100 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-900">
                    Expected result
                  </p>

                  <p className="mt-1 font-mono text-xs text-amber-900">
                    TypeError: 'tuple'
                    object does not
                    support item
                    assignment
                  </p>
                </div>
              </OperationCard>
            </section>

            {/* Create new tuple */}

            <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
                Need another item?
              </p>

              <h2 className="mt-1 text-lg font-semibold text-slate-900">
                Create a new tuple
              </h2>

              <p className="mb-4 mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
                We cannot append to{" "}
                <span className="font-mono font-semibold">
                  {name}
                </span>
                . Instead, combine it
                with another tuple and
                save the result using a
                different variable name.
              </p>

              <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-900">
                    new_tuple =
                  </span>

                  <span className="font-mono text-sm text-slate-700">
                    {name} + (
                  </span>

                  <Field
                    value={
                      args.newTupleVal
                    }
                    onChange={(value) =>
                      setArg(
                        "newTupleVal",
                        value
                      )
                    }
                    placeholder="value"
                    width="w-24"
                    label="Value for new tuple"
                  />

                  <span className="font-mono text-sm text-slate-700">
                    ,)
                  </span>

                  <RunButton
                    onClick={
                      doCreateWithItem
                    }
                    label="Create a new tuple"
                    text="Create"
                  />
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  The comma in{" "}
                  <span className="font-mono">
                    (value,)
                  </span>{" "}
                  makes it a one-item
                  tuple.
                </p>
              </div>

              {derivedTuple && (
                <>
                  <div className="mt-4 grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="mb-2 flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5 text-amber-600" />

                        <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
                          Original —
                          unchanged
                        </span>
                      </div>

                      <p className="break-words font-mono text-sm leading-relaxed text-slate-900">
                        {name} ={" "}
                        {tupleRepr(
                          items
                        )}
                      </p>
                    </div>

                    <div className="flex items-center justify-center">
                      <ArrowRight className="h-5 w-5 rotate-90 text-indigo-500 md:rotate-0" />
                    </div>

                    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                      <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">
                        New tuple
                      </span>

                      <p className="mt-2 break-words font-mono text-sm leading-relaxed text-slate-900">
                        {
                          derivedTuple.name
                        }{" "}
                        ={" "}
                        {tupleRepr(
                          derivedTuple.items
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <p className="text-sm text-emerald-900">
                      <strong>
                        Key idea:
                      </strong>{" "}
                      Python did not add
                      an item to{" "}
                      <span className="font-mono">
                        {name}
                      </span>
                      . It created a
                      different tuple
                      called{" "}
                      <span className="font-mono">
                        new_tuple
                      </span>
                      .
                    </p>
                  </div>
                </>
              )}
            </section>

            {/* More tuple creation */}

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                More ways to create new
                tuples
              </h2>

              <p className="mb-3 text-sm text-slate-600">
                These operations also
                leave{" "}
                <span className="font-mono">
                  {name}
                </span>{" "}
                unchanged.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <OperationCard
                  title={`${name} + other`}
                  tip="The + operator combines two tuples and returns a new tuple. Neither original tuple is modified."
                >
                  <Field
                    value={
                      args.concatVals
                    }
                    onChange={(value) =>
                      setArg(
                        "concatVals",
                        value
                      )
                    }
                    placeholder="6, 2"
                    width="w-36"
                    label="Values for another tuple"
                  />

                  <RunButton
                    onClick={
                      doConcat
                    }
                    label="Concatenate tuples"
                  />

                  <p className="w-full text-[11px] text-slate-500">
                    Separate values with
                    commas.
                  </p>
                </OperationCard>

                <OperationCard
                  title={`${name} * n`}
                  tip="Multiplying a tuple by an integer repeats its items and returns a new tuple."
                >
                  <Field
                    value={
                      args.repeatCount
                    }
                    onChange={(value) =>
                      setArg(
                        "repeatCount",
                        value
                      )
                    }
                    placeholder="n"
                    width="w-16"
                    label="Tuple repeat count"
                  />

                  <RunButton
                    onClick={
                      doRepeat
                    }
                    label="Repeat tuple"
                  />
                </OperationCard>
              </div>
            </section>

            {/* Console */}

            <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2">
                <Terminal className="h-4 w-4 text-emerald-400" />

                <span className="font-mono text-xs uppercase tracking-wider text-slate-400">
                  Console
                </span>

                <button
                  type="button"
                  onClick={() =>
                    setLog([])
                  }
                  className="ml-auto rounded px-2 py-0.5 text-xs text-slate-400 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  Clear
                </button>
              </div>

              <div
                ref={consoleRef}
                className="h-64 space-y-0.5 overflow-y-auto px-4 py-3 font-mono text-sm leading-relaxed"
              >
                {log.length === 0 && (
                  <p className="text-slate-500">
                    Console cleared. Run
                    an operation.
                  </p>
                )}

                {log.map((line) => {
                  if (
                    line.type === "note"
                  ) {
                    return (
                      <p
                        key={line.id}
                        className="text-slate-500"
                      >
                        # {line.text}
                      </p>
                    );
                  }

                  if (
                    line.type === "err"
                  ) {
                    return (
                      <p
                        key={line.id}
                        className="text-rose-400"
                      >
                        Traceback (most
                        recent call
                        last):
                        <br />

                        <span className="text-rose-300">
                          {line.text}
                        </span>
                      </p>
                    );
                  }

                  if (
                    line.type === "in"
                  ) {
                    return (
                      <p
                        key={line.id}
                        className="text-slate-100"
                      >
                        <span className="select-none text-amber-400">
                          &gt;&gt;&gt;{" "}
                        </span>

                        {line.text}
                      </p>
                    );
                  }

                  return (
                    <p
                      key={line.id}
                      className="text-emerald-300"
                    >
                      {line.text}
                    </p>
                  );
                })}
              </div>
            </section>
          </main>

          {/* Python source */}

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <section className="flex max-h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
                <Code2 className="h-4 w-4 text-indigo-600" />

                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Python source
                </span>

                <button
                  type="button"
                  onClick={copyCode}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </div>

              <div className="overflow-y-auto px-4 py-3">
                <ol className="space-y-1.5">
                  {code.map(
                    (
                      line,
                      index
                    ) => {
                      const [
                        body,
                        comment,
                      ] =
                        line.text.split(
                          /(?=\s+#)/
                        );

                      return (
                        <li
                          key={
                            line.id
                          }
                          className="flex gap-3 font-mono text-xs leading-relaxed"
                        >
                          <span className="select-none pt-px text-slate-300">
                            {String(
                              index + 1
                            ).padStart(
                              2,
                              "0"
                            )}
                          </span>

                          <span className="min-w-0 whitespace-pre-wrap break-words text-slate-800">
                            {body}

                            {comment && (
                              <span className="text-slate-400">
                                {
                                  comment
                                }
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    }
                  )}
                </ol>

                <div className="mt-4 border-t border-slate-200 pt-3">
                  <p className="flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />

                    Each playground
                    action is translated
                    into Python so you
                    can connect the
                    visual model with
                    real syntax.
                  </p>

                  <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />

                    In this lesson,{" "}
                    <span className="font-mono font-semibold">
                      {name}
                    </span>{" "}
                    always represents
                    the original tuple.
                    New tuple results
                    use different
                    variable names.
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}