import { washBoxSchema } from '@washqueue/contracts';
import type { WashBox } from '../domain/wash-box.js';
export function mapWashBoxResponse(box: WashBox) {
  return washBoxSchema.parse({
    id: box.id,
    number: box.number,
    isActive: box.isActive,
    createdAt: box.createdAt.toISOString(),
    updatedAt: box.updatedAt.toISOString(),
  });
}
