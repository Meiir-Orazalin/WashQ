import type { ApiResponseSchemaHost } from '@nestjs/swagger';
import { weekdays, openingHoursStatuses } from '@washqueue/contracts';
type Schema = ApiResponseSchemaHost['schema'];
export const branchInputSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'city', 'addressLine', 'timeZone'],
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 100 },
    city: { type: 'string', minLength: 2, maxLength: 100 },
    addressLine: { type: 'string', minLength: 5, maxLength: 250 },
    timeZone: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description:
        'Supported IANA identifier, e.g. Asia/Almaty, Asia/Dubai or UTC; not a numeric offset.',
    },
  },
};
export const branchSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'city', 'addressLine', 'timeZone', 'createdAt', 'updatedAt'],
  properties: {
    ...branchInputSchema.properties,
    id: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};
const entry: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['dayOfWeek', 'status', 'opensAt', 'closesAt', 'closesNextDay'],
  properties: {
    dayOfWeek: { type: 'string', enum: [...weekdays] },
    status: { type: 'string', enum: [...openingHoursStatuses] },
    opensAt: { type: 'string', nullable: true, pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' },
    closesAt: { type: 'string', nullable: true, pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' },
    closesNextDay: { type: 'boolean' },
  },
  oneOf: [
    {
      properties: {
        status: { enum: ['OPEN'] },
        opensAt: { type: 'string', nullable: false },
        closesAt: { type: 'string', nullable: false },
      },
      description:
        'Local HH:mm times; close minute + (next day ? 1440 : 0) - open minute must be 1–1439.',
    },
    {
      properties: {
        status: { enum: ['CLOSED', 'OPEN_24_HOURS'] },
        opensAt: { enum: [null] },
        closesAt: { enum: [null] },
        closesNextDay: { enum: [false] },
      },
    },
  ],
};
export const scheduleSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['openingHours'],
  properties: {
    openingHours: {
      type: 'array',
      minItems: 7,
      maxItems: 7,
      items: entry,
      description:
        'Every weekday exactly once. Request order arbitrary; responses always Monday–Sunday. Local wall-clock values in the branch IANA zone, never UTC timestamps.',
    },
  },
};
export const branchResponseSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['branch'],
  properties: { branch: branchSchema },
};
export const branchDetailSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['branch'],
  properties: {
    branch: {
      ...branchSchema,
      required: [...(branchSchema.required ?? []), 'openingHours'],
      properties: {
        ...branchSchema.properties,
        openingHours: {
          type: 'array',
          items: entry,
          description: 'Empty means unconfigured; otherwise seven canonical weekdays.',
          oneOf: [
            { minItems: 0, maxItems: 0 },
            { minItems: 7, maxItems: 7 },
          ],
        },
      },
    },
  },
};
