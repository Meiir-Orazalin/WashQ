'use client';

import type { PublicVehicle, UpdateVehicleRequest } from '@washqueue/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useVehicleMutations, type VehicleMutationOutcome } from '@/hooks/use-vehicle-mutations';
import { ApiClientError } from '@/lib/api-client';
import {
  validateVehicleEdit,
  vehicleEditFields,
  vehicleEditValues,
  type VehicleEditField,
} from '@/lib/vehicle-edit-form';

export function VehicleItem({
  vehicle,
  userId,
  onOutcome,
}: {
  vehicle: PublicVehicle;
  userId: string;
  onOutcome: (outcome: VehicleMutationOutcome) => void;
}) {
  const [mode, setMode] = useState<'display' | 'edit' | 'delete'>('display');
  const editButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const interacted = useRef(false);
  const { mutation, submit } = useVehicleMutations(userId, vehicle.id, (outcome) => {
    if (outcome === 'missing') setMode('display');
    onOutcome(outcome);
  });

  useEffect(() => {
    if (mode === 'display' && interacted.current) editButton.current?.focus();
    if (mode === 'delete') confirmButton.current?.focus();
  }, [mode]);

  function changeMode(next: typeof mode) {
    if (mutation.isPending) return;
    interacted.current = true;
    mutation.reset();
    setMode(next);
  }

  const error = mutation.isError
    ? mutation.error instanceof ApiClientError && mutation.error.code === 'VEHICLE_ALREADY_EXISTS'
      ? 'You already have a vehicle with this plate number.'
      : 'We could not change your vehicle. Please try again.'
    : null;

  return (
    <li>
      <h3>
        {vehicle.make} {vehicle.model}
      </h3>
      <p className="vehicle-plate">{vehicle.plateNumber}</p>
      {vehicle.productionYear !== null ? <p>Year: {vehicle.productionYear}</p> : null}
      {vehicle.color !== null ? <p>Color: {vehicle.color}</p> : null}
      {mode === 'edit' ? (
        <EditVehicleForm
          vehicle={vehicle}
          pending={mutation.isPending}
          error={error}
          onCancel={() => changeMode('display')}
          onSave={async (patch) => {
            if (await submit({ type: 'update', patch })) setMode('display');
          }}
        />
      ) : mode === 'delete' ? (
        <div role="group" aria-labelledby={`delete-${vehicle.id}`} aria-busy={mutation.isPending}>
          <p id={`delete-${vehicle.id}`}>Delete this vehicle? This cannot be undone.</p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <p role="status">{mutation.isPending ? 'Deleting your vehicle…' : ''}</p>
          <div className="vehicle-actions">
            <button
              ref={confirmButton}
              className="secondary-button destructive-button"
              type="button"
              disabled={mutation.isPending}
              onClick={() => void submit({ type: 'delete' })}
            >
              {mutation.isPending ? 'Deleting…' : 'Confirm delete'}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={mutation.isPending}
              onClick={() => changeMode('display')}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="vehicle-actions">
          <button
            ref={editButton}
            className="secondary-button"
            type="button"
            onClick={() => changeMode('edit')}
          >
            Edit
          </button>
          <button
            className="secondary-button destructive-button"
            type="button"
            onClick={() => changeMode('delete')}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

function EditVehicleForm({
  vehicle,
  pending,
  error,
  onCancel,
  onSave,
}: {
  vehicle: PublicVehicle;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (patch: UpdateVehicleRequest) => Promise<void>;
}) {
  const [initial] = useState(() => vehicleEditValues(vehicle));
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<VehicleEditField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstInput.current?.focus();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = validateVehicleEdit(initial, values);
    setFormError(null);
    setErrors({});
    if (!parsed.success) {
      const next: Partial<Record<VehicleEditField, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = vehicleEditFields.find(({ name }) => name === issue.path[0]);
        if (field && !next[field.name]) next[field.name] = issue.message;
        else if (issue.path.length === 0) setFormError('Change at least one field before saving.');
      }
      setErrors(next);
      return;
    }
    await onSave(parsed.data);
  }

  return (
    <form
      className="registration-form vehicle-edit-form"
      aria-label="Edit vehicle"
      noValidate
      aria-busy={pending}
      onSubmit={(event) => void handleSubmit(event)}
    >
      {vehicleEditFields.map(({ name, label }) => {
        const id = `edit-${vehicle.id}-${name}`;
        return (
          <div className="form-field" key={name}>
            <label htmlFor={id}>{label}</label>
            <input
              id={id}
              ref={name === 'make' ? firstInput : undefined}
              name={name}
              value={values[name]}
              disabled={pending}
              inputMode={name === 'productionYear' ? 'numeric' : 'text'}
              aria-invalid={Boolean(errors[name])}
              aria-describedby={errors[name] ? `${id}-error` : undefined}
              onChange={(event) => {
                setValues((current) => ({ ...current, [name]: event.target.value }));
                setErrors((current) => ({ ...current, [name]: undefined }));
                setFormError(null);
              }}
            />
            {errors[name] ? (
              <p className="field-error" id={`${id}-error`}>
                {errors[name]}
              </p>
            ) : null}
          </div>
        );
      })}
      {formError || error ? (
        <p className="form-error" role="alert">
          {formError ?? error}
        </p>
      ) : null}
      <p role="status">{pending ? 'Saving your changes…' : ''}</p>
      <div className="vehicle-actions">
        <button className="submit-button" type="submit" disabled={pending}>
          {pending ? 'Saving changes…' : 'Save'}
        </button>
        <button className="secondary-button" type="button" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
