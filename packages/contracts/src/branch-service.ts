import { z } from 'zod';
import { branchIdParamsSchema } from './branch.js';
import { createOrganizationRequestSchema, publicOrganizationSchema } from './organization.js';

// These business text rules exactly match the existing organization text rules.
const nameSchema = createOrganizationRequestSchema.shape.name;
const descriptionSchema = createOrganizationRequestSchema.shape.description.unwrap();
export const serviceDurationMinutesSchema = z.number().int().min(1).max(1440);
export const servicePriceMinorSchema = z
  .number()
  .int()
  .min(1)
  .max(100000000)
  .refine(Number.isSafeInteger);
export const createBranchServiceRequestSchema = z.strictObject({
  name: nameSchema,
  description: descriptionSchema.default(null),
  durationMinutes: serviceDurationMinutesSchema,
  priceMinor: servicePriceMinorSchema,
  currency: z.literal('KZT'),
});
export const updateBranchServiceRequestSchema = z
  .strictObject({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    durationMinutes: serviceDurationMinutesSchema.optional(),
    priceMinor: servicePriceMinorSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'Provide at least one service field to update',
  });
export const publicBranchServiceSchema = z.strictObject({
  id: z.uuid(),
  name: publicOrganizationSchema.shape.name,
  description: publicOrganizationSchema.shape.description,
  durationMinutes: serviceDurationMinutesSchema,
  priceMinor: servicePriceMinorSchema,
  currency: z.literal('KZT'),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const branchServiceResponseSchema = z.strictObject({ service: publicBranchServiceSchema });
export const branchServiceListResponseSchema = z.strictObject({
  services: z.array(publicBranchServiceSchema),
});
export const branchServiceIdParamsSchema = branchIdParamsSchema.extend({ serviceId: z.uuid() });
export type CreateBranchServiceInput = z.input<typeof createBranchServiceRequestSchema>;
export type CreateBranchServiceRequest = z.infer<typeof createBranchServiceRequestSchema>;
export type UpdateBranchServiceRequest = z.infer<typeof updateBranchServiceRequestSchema>;
export type PublicBranchService = z.infer<typeof publicBranchServiceSchema>;
export type BranchServiceResponse = z.infer<typeof branchServiceResponseSchema>;
export type BranchServiceListResponse = z.infer<typeof branchServiceListResponseSchema>;
export type BranchServiceIdParams = z.infer<typeof branchServiceIdParamsSchema>;
