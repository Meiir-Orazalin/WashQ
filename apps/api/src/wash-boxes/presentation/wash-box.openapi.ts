import type { ApiResponseSchemaHost } from '@nestjs/swagger';
type Schema = ApiResponseSchemaHost['schema'];
export const createWashBoxInputSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['number'],
  properties: { number: { type: 'integer', minimum: 1, maximum: 999 } },
};
export const activeStateInputSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['isActive'],
  properties: { isActive: { type: 'boolean' } },
};
export const publicWashBoxSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'number', 'isActive', 'createdAt', 'updatedAt'],
  properties: {
    ...createWashBoxInputSchema.properties,
    ...activeStateInputSchema.properties,
    id: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};
export const singleWashBoxSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['washBox'],
  properties: { washBox: publicWashBoxSchema },
};
export const washBoxListSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['washBoxes'],
  properties: { washBoxes: { type: 'array', items: publicWashBoxSchema } },
};
