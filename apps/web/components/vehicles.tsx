'use client';

import { createVehicleRequestSchema, type CreateVehicleRequest } from '@washqueue/contracts';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { useVehicles } from '@/hooks/use-vehicles';
import { ApiClientError } from '@/lib/api-client';
import { useAuthentication } from '@/providers/authentication-provider';
import { LoginForm } from './login-form';
import { VehicleItem } from './vehicle-item';
import type { VehicleMutationOutcome } from '@/hooks/use-vehicle-mutations';

export function Vehicles() {
  const authentication = useAuthentication();
  if (authentication.status !== 'authenticated' || !authentication.currentUser) {
    return (
      <>
        {authentication.status === 'unauthenticated' ||
        authentication.status === 'authenticating' ? (
          <p role="status">Sign in to add and view your vehicles.</p>
        ) : (
          <LoginForm />
        )}
        <nav className="form-links" aria-label="Vehicle account options">
          <Link href="/login">Sign in</Link>
          <Link href="/">Back to home</Link>
        </nav>
      </>
    );
  }
  const user = authentication.currentUser;
  return (
    <>
      <p>
        Signed in as{' '}
        <strong>
          {user.firstName} {user.lastName}
        </strong>{' '}
        <span>{user.email}</span>
      </p>
      <div className="authentication-actions">
        <Link href="/login">Manage sign-in</Link>
        <Link href="/profile">Your profile</Link>
        <button
          className="secondary-button"
          type="button"
          onClick={() => void authentication.logout()}
        >
          Sign out
        </button>
        <Link href="/">Back to home</Link>
      </div>
      <CustomerVehicles key={user.id} userId={user.id} />
    </>
  );
}

const emptyForm = { make: '', model: '', plateNumber: '', productionYear: '', color: '' };
type Field = keyof typeof emptyForm;
const fields: readonly { name: Field; label: string }[] = [
  { name: 'make', label: 'Make' },
  { name: 'model', label: 'Model' },
  { name: 'plateNumber', label: 'Plate number' },
  { name: 'productionYear', label: 'Production year (optional)' },
  { name: 'color', label: 'Color (optional)' },
];

function CustomerVehicles({ userId }: { userId: string }) {
  const { query, mutation, submit } = useVehicles(userId);
  const [values, setValues] = useState(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [success, setSuccess] = useState(false);
  const [vehicleFeedback, setVehicleFeedback] = useState('');
  const listHeading = useRef<HTMLHeadingElement>(null);

  function handleVehicleOutcome(outcome: VehicleMutationOutcome) {
    setVehicleFeedback(
      outcome === 'missing'
        ? 'This vehicle is no longer available.'
        : outcome === 'deleted'
          ? 'Vehicle deleted.'
          : 'Vehicle updated.',
    );
    if (outcome !== 'updated') listHeading.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    setSuccess(false);
    mutation.reset();
    const year = values.productionYear.trim();
    const parsed = createVehicleRequestSchema.safeParse({
      ...values,
      productionYear: year === '' ? null : /^\d+$/.test(year) ? Number(year) : year,
    });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = fields.find(({ name }) => name === issue.path[0]);
        if (field && !next[field.name]) next[field.name] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    if (await submit(parsed.data satisfies CreateVehicleRequest)) {
      setValues(emptyForm);
      setSuccess(true);
    }
  }

  return (
    <div className="vehicle-layout">
      <section aria-labelledby="create-vehicle-heading">
        <h2 id="create-vehicle-heading">Add a vehicle</h2>
        <form
          className="registration-form"
          noValidate
          aria-busy={mutation.isPending}
          onSubmit={(event) => void handleSubmit(event)}
        >
          {fields.map(({ name, label }) => (
            <div className="form-field" key={name}>
              <label htmlFor={`vehicle-${name}`}>{label}</label>
              <input
                id={`vehicle-${name}`}
                name={name}
                value={values[name]}
                inputMode={name === 'productionYear' ? 'numeric' : 'text'}
                aria-invalid={Boolean(errors[name])}
                aria-describedby={errors[name] ? `vehicle-${name}-error` : undefined}
                onChange={(event) => {
                  setValues((current) => ({ ...current, [name]: event.target.value }));
                  setErrors((current) => ({ ...current, [name]: undefined }));
                }}
              />
              {errors[name] ? (
                <p className="field-error" id={`vehicle-${name}-error`}>
                  {errors[name]}
                </p>
              ) : null}
            </div>
          ))}
          {mutation.isError ? (
            <p className="form-error" role="alert">
              {mutation.error instanceof ApiClientError &&
              mutation.error.code === 'VEHICLE_ALREADY_EXISTS'
                ? 'You already have a vehicle with this plate number.'
                : 'We could not save your vehicle. Please try again.'}
            </p>
          ) : null}
          <p role="status" aria-live="polite">
            {mutation.isPending ? 'Saving your vehicle…' : success ? 'Vehicle added.' : ''}
          </p>
          <button className="submit-button" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Add vehicle'}
          </button>
        </form>
      </section>
      <section aria-labelledby="saved-vehicles-heading" aria-busy={query.isPending}>
        <h2 ref={listHeading} tabIndex={-1} id="saved-vehicles-heading">
          Your vehicles
        </h2>
        <p role="status" aria-live="polite">
          {vehicleFeedback}
        </p>
        {query.isPending ? (
          <p role="status">Loading your vehicles…</p>
        ) : query.isError ? (
          <div role="alert">
            <p>We could not load your vehicles.</p>
            <button className="secondary-button" type="button" onClick={() => void query.refetch()}>
              Try again
            </button>
          </div>
        ) : query.data.vehicles.length === 0 ? (
          <p>No vehicles yet. Add your first vehicle.</p>
        ) : (
          <ul className="vehicle-list">
            {query.data.vehicles.map((vehicle) => (
              <VehicleItem
                key={vehicle.id}
                vehicle={vehicle}
                userId={userId}
                onOutcome={handleVehicleOutcome}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
