import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  createVehicleRequestSchema,
  updateVehicleRequestSchema,
  vehicleIdParamsSchema,
  type CreateVehicleRequest,
  type UpdateVehicleRequest,
  type VehicleIdParams,
} from '@washqueue/contracts';

export class VehicleIdParamsDto implements VehicleIdParams {
  static readonly schema = vehicleIdParamsSchema;
  @ApiProperty({ format: 'uuid' }) declare vehicleId: string;
}

export class UpdateVehicleRequestDto implements UpdateVehicleRequest {
  static readonly schema = updateVehicleRequestSchema;
  @ApiPropertyOptional({
    minLength: 2,
    maxLength: 60,
    description: 'Trimmed, whitespace collapsed; cannot be null.',
  })
  declare make?: string;
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 60,
    description: 'Trimmed, whitespace collapsed; cannot be null.',
  })
  declare model?: string;
  @ApiPropertyOptional({
    minLength: 2,
    maxLength: 20,
    description: 'NFKC, uppercase, spaces/hyphens removed; Unicode letters/digits; cannot be null.',
  })
  declare plateNumber?: string;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 1900,
    description: 'Integer through current UTC year plus one. Null clears; omitted retains.',
  })
  declare productionYear?: number | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 40,
    description: 'Trimmed, whitespace collapsed. Empty or null clears; omitted retains.',
  })
  declare color?: string | null;
}

export class CreateVehicleRequestDto implements CreateVehicleRequest {
  static readonly schema = createVehicleRequestSchema;
  @ApiProperty({
    minLength: 2,
    maxLength: 60,
    description: 'Trimmed; internal whitespace collapsed; casing preserved.',
  })
  declare make: string;
  @ApiProperty({ minLength: 1, maxLength: 60 })
  declare model: string;
  @ApiProperty({
    minLength: 2,
    maxLength: 20,
    description:
      'NFKC, uppercase, spaces/hyphens removed; Unicode letters and digits only. Unique per customer.',
  })
  declare plateNumber: string;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 1900,
    description: 'Integer, at most the current UTC year plus one.',
  })
  declare productionYear: number | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 40,
    description: 'Trimmed and whitespace collapsed. Empty becomes null.',
  })
  declare color: string | null;
}

export class PublicVehicleDto {
  @ApiProperty({ format: 'uuid' }) declare id: string;
  @ApiProperty() declare make: string;
  @ApiProperty() declare model: string;
  @ApiProperty() declare plateNumber: string;
  @ApiProperty({ type: Number, nullable: true }) declare productionYear: number | null;
  @ApiProperty({ type: String, nullable: true }) declare color: string | null;
  @ApiProperty({ format: 'date-time' }) declare createdAt: string;
  @ApiProperty({ format: 'date-time' }) declare updatedAt: string;
}

export class CreateVehicleResponseDto {
  @ApiProperty({ type: PublicVehicleDto }) declare vehicle: PublicVehicleDto;
}

export class UpdateVehicleResponseDto {
  @ApiProperty({ type: PublicVehicleDto }) declare vehicle: PublicVehicleDto;
}

export class VehicleListResponseDto {
  @ApiProperty({ type: [PublicVehicleDto] }) declare vehicles: PublicVehicleDto[];
}
