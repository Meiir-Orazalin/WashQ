import { z } from 'zod';

const normalizeWhitespace = (value: string) => value.trim().replace(/\s+/gu, ' ');
const normalizedText = (minimum: number, maximum: number) =>
  z.string().transform(normalizeWhitespace).pipe(z.string().min(minimum).max(maximum));

const plateNumberSchema = z
  .string()
  .transform((value) =>
    value
      .normalize('NFKC')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/gu, ''),
  )
  .pipe(z.string().regex(/^[\p{L}\p{Nd}]+$/u, 'Use only letters and digits'))
  .refine((value) => [...value].length >= 2 && [...value].length <= 20, {
    message: 'Plate number must contain 2–20 characters',
  });

const productionYearSchema = z
  .number()
  .int()
  .min(1900)
  .refine((value) => value <= new Date().getUTCFullYear() + 1, {
    message: 'Production year cannot exceed next year',
  });

const colorSchema = z
  .string()
  .transform(normalizeWhitespace)
  .pipe(z.string().max(40))
  .transform((value) => value || null);

export const createVehicleRequestSchema = z.strictObject({
  make: normalizedText(2, 60),
  model: normalizedText(1, 60),
  plateNumber: plateNumberSchema,
  productionYear: productionYearSchema.nullable().default(null),
  color: colorSchema.nullable().default(null),
});

// Responses must already be canonical: parsing must not repair server output.
export const publicVehicleSchema = z.strictObject({
  id: z.uuid(),
  make: z
    .string()
    .min(2)
    .max(60)
    .refine((value) => value === normalizeWhitespace(value)),
  model: z
    .string()
    .min(1)
    .max(60)
    .refine((value) => value === normalizeWhitespace(value)),
  plateNumber: z.string().refine(
    (value) => {
      const parsed = plateNumberSchema.safeParse(value);
      return parsed.success && parsed.data === value;
    },
    { message: 'Plate number must be canonical' },
  ),
  productionYear: productionYearSchema.nullable(),
  color: z
    .string()
    .min(1)
    .max(40)
    .refine((value) => value === normalizeWhitespace(value))
    .nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const createVehicleResponseSchema = z.strictObject({ vehicle: publicVehicleSchema });
export const vehicleListResponseSchema = z.strictObject({ vehicles: z.array(publicVehicleSchema) });

export type CreateVehicleRequest = z.infer<typeof createVehicleRequestSchema>;
export type CreateVehicleInput = z.input<typeof createVehicleRequestSchema>;
export type PublicVehicle = z.infer<typeof publicVehicleSchema>;
export type CreateVehicleResponse = z.infer<typeof createVehicleResponseSchema>;
export type VehicleListResponse = z.infer<typeof vehicleListResponseSchema>;
