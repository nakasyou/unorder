/** JSON-Schema-like description of method inputs and outputs. */
export interface SchemaBase {
  readonly title?: string
  readonly description?: string
  readonly default?: unknown
}

export interface StringSchema extends SchemaBase {
  readonly type: 'string'
  readonly enum?: readonly string[]
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
  readonly format?: 'date-time' | 'uri' | 'email'
}

export interface NumberSchema extends SchemaBase {
  readonly type: 'number'
  readonly minimum?: number
  readonly maximum?: number
}

export interface IntegerSchema extends SchemaBase {
  readonly type: 'integer'
  readonly minimum?: number
  readonly maximum?: number
}

export interface BooleanSchema extends SchemaBase {
  readonly type: 'boolean'
}

export interface NullSchema extends SchemaBase {
  readonly type: 'null'
}

export interface ArraySchema extends SchemaBase {
  readonly type: 'array'
  readonly items: Schema
  readonly minItems?: number
  readonly maxItems?: number
}

export interface ObjectSchema extends SchemaBase {
  readonly type: 'object'
  readonly properties: Record<string, Schema>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean | Schema
}

export interface AnyOfSchema extends SchemaBase {
  readonly anyOf: readonly Schema[]
}

export interface UnknownSchema extends SchemaBase {
  readonly type: 'unknown'
}

export type Schema =
  | StringSchema
  | NumberSchema
  | IntegerSchema
  | BooleanSchema
  | NullSchema
  | ArraySchema
  | ObjectSchema
  | AnyOfSchema
  | UnknownSchema

/** Marks an object member as optional. Optional wrappers never reach JSON Schema. */
export interface OptionalSchema {
  readonly optional: true
  readonly schema: Schema
}

export type PropertySchema = Schema | OptionalSchema

const isOptional = (value: PropertySchema): value is OptionalSchema =>
  'optional' in value && value.optional === true

const string = (options: Omit<StringSchema, 'type'> = {}): StringSchema => ({
  type: 'string',
  ...options,
})

const number = (options: Omit<NumberSchema, 'type'> = {}): NumberSchema => ({
  type: 'number',
  ...options,
})

const integer = (options: Omit<IntegerSchema, 'type'> = {}): IntegerSchema => ({
  type: 'integer',
  ...options,
})

const boolean = (options: Omit<BooleanSchema, 'type'> = {}): BooleanSchema => ({
  type: 'boolean',
  ...options,
})

const nullType = (options: Omit<NullSchema, 'type'> = {}): NullSchema => ({
  type: 'null',
  ...options,
})

const unknown = (options: Omit<UnknownSchema, 'type'> = {}): UnknownSchema => ({
  type: 'unknown',
  ...options,
})

const array = (items: Schema, options: Omit<ArraySchema, 'type' | 'items'> = {}): ArraySchema => ({
  type: 'array',
  items,
  ...options,
})

const object = (
  properties: Record<string, PropertySchema>,
  options: Omit<ObjectSchema, 'type' | 'properties' | 'required'> = {},
): ObjectSchema => {
  const required: string[] = []
  const plain: Record<string, Schema> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (isOptional(value)) {
      plain[key] = value.schema
    } else {
      plain[key] = value
      required.push(key)
    }
  }
  return {
    type: 'object',
    properties: plain,
    ...(required.length > 0 ? { required } : {}),
    ...options,
  }
}

const anyOf = (
  variants: readonly Schema[],
  options: Omit<AnyOfSchema, 'anyOf'> = {},
): AnyOfSchema => ({
  anyOf: variants,
  ...options,
})

const optional = (schema: Schema): OptionalSchema => ({ optional: true, schema })

export const s = {
  string,
  number,
  integer,
  boolean,
  null: nullType,
  unknown,
  array,
  object,
  anyOf,
  optional,
} as const

export interface SchemaIssue {
  readonly path: string
  readonly message: string
}

const pathFor = (base: string, key: string | number) =>
  typeof key === 'number' ? `${base}[${key}]` : base ? `${base}.${key}` : key

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isSchema = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !('optional' in value)

/** Validates a value against the lightweight schema dialect used by Unorder. */
export const validateSchema = (schema: Schema, value: unknown, basePath = ''): SchemaIssue[] => {
  if ('anyOf' in schema) {
    const results = schema.anyOf.map((variant) => validateSchema(variant, value, basePath))
    if (results.some((issues) => issues.length === 0)) {
      return []
    }
    return [
      {
        path: basePath || '$',
        message: 'Value does not match any allowed schema variant',
      },
    ]
  }

  if ('type' in schema && schema.type === 'unknown') {
    return []
  }

  const path = basePath || '$'

  if ('type' in schema && schema.type === 'object') {
    if (!isRecord(value)) {
      return [{ path, message: 'Expected an object' }]
    }
    const issues: SchemaIssue[] = []
    for (const key of schema.required ?? []) {
      if (!(key in value)) {
        issues.push({ path: pathFor(path, key), message: 'Required property is missing' })
      }
    }
    for (const [key, property] of Object.entries(schema.properties)) {
      if (key in value) {
        issues.push(...validateSchema(property, value[key], pathFor(path, key)))
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) {
          issues.push({ path: pathFor(path, key), message: 'Unknown property' })
        }
      }
    } else if (isSchema(schema.additionalProperties)) {
      for (const [key, item] of Object.entries(value)) {
        if (!(key in schema.properties)) {
          issues.push(...validateSchema(schema.additionalProperties, item, pathFor(path, key)))
        }
      }
    }
    return issues
  }

  if ('type' in schema && schema.type === 'array') {
    if (!Array.isArray(value)) {
      return [{ path, message: 'Expected an array' }]
    }
    const issues: SchemaIssue[] = []
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      issues.push({ path, message: `Expected at least ${schema.minItems} items` })
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      issues.push({ path, message: `Expected at most ${schema.maxItems} items` })
    }
    value.forEach((item, index) => {
      issues.push(...validateSchema(schema.items, item, pathFor(path, index)))
    })
    return issues
  }

  if ('type' in schema && schema.type === 'string') {
    if (typeof value !== 'string') {
      return [{ path, message: 'Expected a string' }]
    }
    const issues: SchemaIssue[] = []
    if (schema.enum && !schema.enum.includes(value)) {
      issues.push({ path, message: `Expected one of: ${schema.enum.join(', ')}` })
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push({ path, message: `Expected at least ${schema.minLength} characters` })
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      issues.push({ path, message: `Expected at most ${schema.maxLength} characters` })
    }
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          issues.push({ path, message: `Expected a value matching ${schema.pattern}` })
        }
      } catch {
        issues.push({ path: '$schema', message: `Invalid pattern: ${schema.pattern}` })
      }
    }
    return issues
  }

  if ('type' in schema && (schema.type === 'number' || schema.type === 'integer')) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      const expected = schema.type === 'integer' ? 'an integer' : 'a number'
      return [{ path, message: `Expected ${expected}` }]
    }
    if (schema.type === 'integer' && !Number.isInteger(value)) {
      return [{ path, message: 'Expected an integer' }]
    }
    const issues: SchemaIssue[] = []
    if (schema.minimum !== undefined && value < schema.minimum) {
      issues.push({ path, message: `Expected a value >= ${schema.minimum}` })
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      issues.push({ path, message: `Expected a value <= ${schema.maximum}` })
    }
    return issues
  }

  if ('type' in schema && schema.type === 'boolean' && typeof value !== 'boolean') {
    return [{ path, message: 'Expected a boolean' }]
  }

  if ('type' in schema && schema.type === 'null' && value !== null) {
    return [{ path, message: 'Expected null' }]
  }

  return []
}
