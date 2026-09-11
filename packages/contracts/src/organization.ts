import { z } from 'zod';

const normalizeName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
const noControls = (value: string) => !/\p{Cc}/u.test(value);
const descriptionControlsAllowed = (value: string) =>
  [...value].every(
    (character) => noControls(character) || character === '\n' || character === '\r',
  );
const nameSchema = z
  .string()
  .refine(noControls, 'Control characters are not allowed')
  .transform(normalizeName)
  .pipe(z.string().min(2).max(120));
const descriptionSchema = z
  .string()
  .refine(descriptionControlsAllowed, 'Only line breaks are permitted control characters')
  .transform((value) => value.trim())
  .pipe(z.string().max(500))
  .transform((value) => value || null);

export const createOrganizationRequestSchema = z.strictObject({
  name: nameSchema,
  description: descriptionSchema.nullable().default(null),
});
export const organizationIdParamsSchema = z.strictObject({ organizationId: z.uuid() });
// Public responses must already be normalized; do not repair invalid server output.
export const publicOrganizationSchema = z.strictObject({
  id: z.uuid(),
  name: z
    .string()
    .min(2)
    .max(120)
    .refine(noControls)
    .refine((value) => value === normalizeName(value)),
  description: z
    .string()
    .min(1)
    .max(500)
    .refine(descriptionControlsAllowed)
    .refine((value) => value === value.trim())
    .nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const createOrganizationResponseSchema = z.strictObject({
  organization: publicOrganizationSchema,
});
export const organizationDetailResponseSchema = z.strictObject({
  organization: publicOrganizationSchema,
});
export const organizationListResponseSchema = z.strictObject({
  organizations: z.array(publicOrganizationSchema),
});
export type CreateOrganizationInput = z.input<typeof createOrganizationRequestSchema>;
export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>;
export type OrganizationIdParams = z.infer<typeof organizationIdParamsSchema>;
export type PublicOrganization = z.infer<typeof publicOrganizationSchema>;
export type CreateOrganizationResponse = z.infer<typeof createOrganizationResponseSchema>;
export type OrganizationDetailResponse = z.infer<typeof organizationDetailResponseSchema>;
export type OrganizationListResponse = z.infer<typeof organizationListResponseSchema>;
