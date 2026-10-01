import { z } from 'zod';
import { branchIdParamsSchema } from './branch.js';

const washBoxNumberSchema = z.number().int().min(1).max(999);
export const createWashBoxRequestSchema = z.strictObject({ number: washBoxNumberSchema });
export const setWashBoxActiveStateRequestSchema = z.strictObject({ isActive: z.boolean() });
export const washBoxSchema = z.strictObject({
  id: z.uuid(),
  number: washBoxNumberSchema,
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const washBoxResponseSchema = z.strictObject({ washBox: washBoxSchema });
export const washBoxListResponseSchema = z.strictObject({ washBoxes: z.array(washBoxSchema) });
export const washBoxIdParamsSchema = branchIdParamsSchema.extend({ washBoxId: z.uuid() });
export type CreateWashBoxRequest = z.infer<typeof createWashBoxRequestSchema>;
export type SetWashBoxActiveStateRequest = z.infer<typeof setWashBoxActiveStateRequestSchema>;
export type PublicWashBox = z.infer<typeof washBoxSchema>;
export type WashBoxResponse = z.infer<typeof washBoxResponseSchema>;
export type WashBoxListResponse = z.infer<typeof washBoxListResponseSchema>;
export type WashBoxIdParams = z.infer<typeof washBoxIdParamsSchema>;
