/** Syntax-aware JSON section edits that preserve every byte outside the owned value range. */

interface ScalarNode {
  readonly kind: "scalar";
  readonly start: number;
  readonly end: number;
}

interface ObjectProperty {
  readonly key: string;
  readonly keyStart: number;
  readonly value: JsonNode;
}

interface ObjectNode {
  readonly kind: "object";
  readonly start: number;
  readonly end: number;
  readonly close: number;
  readonly properties: readonly ObjectProperty[];
}

interface ArrayNode {
  readonly kind: "array";
  readonly start: number;
  readonly end: number;
  readonly close: number;
  readonly items: readonly JsonNode[];
}

type JsonNode = ScalarNode | ObjectNode | ArrayNode;

export class JsonSpliceError extends Error {
  constructor() {
    super("invalid_json_splice");
    this.name = "JsonSpliceError";
  }
}

class JsonScanner {
  private index = 0;

  constructor(private readonly text: string) {}

  parse(): JsonNode {
    this.skipWhitespace();
    const node = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.text.length) throw new JsonSpliceError();
    return node;
  }

  private character(): string {
    return this.text.charAt(this.index);
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.character())) this.index += 1;
  }

  private parseValue(): JsonNode {
    const character = this.character();
    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (character === '"') return this.parseStringNode();
    return this.parsePrimitive();
  }

  private scanString(): { readonly start: number; readonly end: number } {
    const start = this.index;
    if (this.character() !== '"') throw new JsonSpliceError();
    this.index += 1;
    while (this.index < this.text.length) {
      const character = this.character();
      if (character === '"') {
        this.index += 1;
        return { start, end: this.index };
      }
      if (character === "\\") {
        this.index += 1;
        const escape = this.character();
        if (escape === "u") {
          if (!/^[0-9a-f]{4}$/iu.test(this.text.slice(this.index + 1, this.index + 5))) {
            throw new JsonSpliceError();
          }
          this.index += 5;
          continue;
        }
        if (!['"', "\\", "/", "b", "f", "n", "r", "t"].includes(escape)) {
          throw new JsonSpliceError();
        }
        this.index += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) throw new JsonSpliceError();
      this.index += 1;
    }
    throw new JsonSpliceError();
  }

  private parseStringNode(): ScalarNode {
    const span = this.scanString();
    return { kind: "scalar", ...span };
  }

  private parsePrimitive(): ScalarNode {
    const start = this.index;
    const source = this.text.slice(start);
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(source);
    if (match?.[0] === undefined) throw new JsonSpliceError();
    this.index += match[0].length;
    return { kind: "scalar", start, end: this.index };
  }

  private parseObject(): ObjectNode {
    const start = this.index;
    const properties: ObjectProperty[] = [];
    this.index += 1;
    this.skipWhitespace();
    if (this.character() === "}") {
      const close = this.index;
      this.index += 1;
      return { kind: "object", start, close, end: this.index, properties };
    }
    while (this.index < this.text.length) {
      const keySpan = this.scanString();
      let key: unknown;
      try { key = JSON.parse(this.text.slice(keySpan.start, keySpan.end)); } catch { throw new JsonSpliceError(); }
      if (typeof key !== "string") throw new JsonSpliceError();
      this.skipWhitespace();
      if (this.character() !== ":") throw new JsonSpliceError();
      this.index += 1;
      this.skipWhitespace();
      const value = this.parseValue();
      properties.push({ key, keyStart: keySpan.start, value });
      this.skipWhitespace();
      if (this.character() === "}") {
        const close = this.index;
        this.index += 1;
        return { kind: "object", start, close, end: this.index, properties };
      }
      if (this.character() !== ",") throw new JsonSpliceError();
      this.index += 1;
      this.skipWhitespace();
    }
    throw new JsonSpliceError();
  }

  private parseArray(): ArrayNode {
    const start = this.index;
    const items: JsonNode[] = [];
    this.index += 1;
    this.skipWhitespace();
    if (this.character() === "]") {
      const close = this.index;
      this.index += 1;
      return { kind: "array", start, close, end: this.index, items };
    }
    while (this.index < this.text.length) {
      items.push(this.parseValue());
      this.skipWhitespace();
      if (this.character() === "]") {
        const close = this.index;
        this.index += 1;
        return { kind: "array", start, close, end: this.index, items };
      }
      if (this.character() !== ",") throw new JsonSpliceError();
      this.index += 1;
      this.skipWhitespace();
    }
    throw new JsonSpliceError();
  }
}

function rootObject(text: string): ObjectNode {
  const root = new JsonScanner(text).parse();
  if (root.kind !== "object") throw new JsonSpliceError();
  return root;
}

function uniqueProperty(object: ObjectNode, key: string): ObjectProperty | undefined {
  const matches = object.properties.filter((property) => property.key === key);
  if (matches.length > 1) throw new JsonSpliceError();
  return matches[0];
}

function existingObject(root: ObjectNode, objectPath: readonly string[]): ObjectNode {
  let current = root;
  for (const key of objectPath) {
    const property = uniqueProperty(current, key);
    if (property === undefined || property.value.kind !== "object") throw new JsonSpliceError();
    current = property.value;
  }
  return current;
}

function existingArray(root: ObjectNode, arrayPath: readonly string[]): ArrayNode {
  if (arrayPath.length === 0) throw new JsonSpliceError();
  const object = existingObject(root, arrayPath.slice(0, -1));
  const property = uniqueProperty(object, arrayPath.at(-1) ?? "");
  if (property === undefined || property.value.kind !== "array") throw new JsonSpliceError();
  return property.value;
}

function splice(text: string, start: number, end: number, replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(end);
}

function nestedObject(path: readonly string[], key: string, value: unknown): unknown {
  let nested: unknown = { [key]: value };
  for (const segment of [...path].reverse()) nested = { [segment]: nested };
  return nested;
}

export function upsertJsonObjectProperty(
  text: string,
  objectPath: readonly string[],
  key: string,
  value: unknown,
): string {
  const root = rootObject(text);
  let current = root;
  for (const [index, segment] of objectPath.entries()) {
    const property = uniqueProperty(current, segment);
    if (property === undefined) {
      return insertObjectProperty(text, current, segment, nestedObject(objectPath.slice(index + 1), key, value));
    }
    if (property.value.kind !== "object") throw new JsonSpliceError();
    current = property.value;
  }
  const property = uniqueProperty(current, key);
  if (property !== undefined) {
    return splice(text, property.value.start, property.value.end, JSON.stringify(value));
  }
  return insertObjectProperty(text, current, key, value);
}

function insertObjectProperty(text: string, object: ObjectNode, key: string, value: unknown): string {
  const rendered = `${JSON.stringify(key)}:${JSON.stringify(value)}`;
  const previous = object.properties.at(-1);
  return previous === undefined
    ? splice(text, object.close, object.close, rendered)
    : splice(text, previous.value.end, previous.value.end, `,${rendered}`);
}

export function removeJsonObjectProperty(
  text: string,
  objectPath: readonly string[],
  key: string,
): string {
  const object = existingObject(rootObject(text), objectPath);
  const index = object.properties.findIndex((property) => property.key === key);
  if (index < 0) throw new JsonSpliceError();
  if (object.properties.filter((property) => property.key === key).length !== 1) throw new JsonSpliceError();
  const property = object.properties[index];
  if (property === undefined) throw new JsonSpliceError();
  const previous = object.properties[index - 1];
  const next = object.properties[index + 1];
  if (next !== undefined) return splice(text, property.keyStart, next.keyStart, "");
  if (previous !== undefined) return splice(text, previous.value.end, property.value.end, "");
  return splice(text, property.keyStart, property.value.end, "");
}

export function upsertJsonArrayElement(
  text: string,
  arrayPath: readonly string[],
  index: number,
  value: unknown,
): string {
  const array = existingArray(rootObject(text), arrayPath);
  if (!Number.isSafeInteger(index) || index < 0 || index > array.items.length) throw new JsonSpliceError();
  const rendered = JSON.stringify(value);
  const current = array.items[index];
  if (current !== undefined) return splice(text, current.start, current.end, rendered);
  const previous = array.items.at(-1);
  return previous === undefined
    ? splice(text, array.close, array.close, rendered)
    : splice(text, previous.end, previous.end, `,${rendered}`);
}

export function removeJsonArrayElement(
  text: string,
  arrayPath: readonly string[],
  index: number,
): string {
  const array = existingArray(rootObject(text), arrayPath);
  const current = array.items[index];
  if (current === undefined) throw new JsonSpliceError();
  const previous = array.items[index - 1];
  const next = array.items[index + 1];
  if (next !== undefined) return splice(text, current.start, next.start, "");
  if (previous !== undefined) return splice(text, previous.end, current.end, "");
  return splice(text, current.start, current.end, "");
}
