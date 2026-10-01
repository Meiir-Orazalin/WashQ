import type { ApiResponseSchemaHost } from '@nestjs/swagger';
type Schema = ApiResponseSchemaHost['schema'];
const mutableProperties: NonNullable<Schema>['properties'] = {
  name: {
    type: 'string',
    minLength: 2,
    maxLength: 120,
    description:
      'NFKC, trim, whitespace collapse; casing retained; controls rejected before normalization.',
  },
  description: {
    type: 'string',
    nullable: true,
    maxLength: 500,
    description: 'Trimmed plain text; CR/LF allowed; null or blank clears; omitted PATCH retains.',
  },
  durationMinutes: {
    type: 'integer',
    minimum: 1,
    maximum: 1440,
    description: 'Catalogue duration, not booking slots.',
  },
  priceMinor: {
    type: 'integer',
    minimum: 1,
    maximum: 100000000,
    description: 'Hundredths of KZT; positive fixed price. Maximum is a product guardrail.',
  },
};
export const createServiceInputSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'durationMinutes', 'priceMinor', 'currency'],
  properties: { ...mutableProperties, currency: { type: 'string', enum: ['KZT'] } },
};
export const updateServiceInputSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    ...mutableProperties,
    isActive: {
      type: 'boolean',
      description: 'Explicit assignment, not a toggle or availability.',
    },
  },
};
export const publicServiceSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'description',
    'durationMinutes',
    'priceMinor',
    'currency',
    'isActive',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    ...mutableProperties,
    currency: { type: 'string', enum: ['KZT'] },
    isActive: { type: 'boolean' },
    id: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};
export const serviceResponseSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['service'],
  properties: { service: publicServiceSchema },
};
export const serviceListSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['services'],
  properties: { services: { type: 'array', items: publicServiceSchema } },
};
