'use client';
import type { PublicBranchService } from '@washqueue/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useOwnedBranch } from '@/hooks/use-branches';
import { useOwnedOrganization } from '@/hooks/use-organizations';
import {
  useBranchServices,
  useBranchServiceWrite,
  useBranchServiceCacheBoundary,
} from '@/hooks/use-branch-services';
import {
  emptyBranchServiceFields,
  serviceEditFields,
  validateServiceForm,
  serviceFailureMessage,
  serviceCreationFailureMessage,
  type BranchServiceFields,
} from '@/lib/branch-service-form';
import { formatKztPrice } from '@/lib/kzt-price';
import { BranchAuthenticationBoundary } from './branch-authentication-boundary';
import { BranchFailure } from './branches';

interface Scope {
  userId: string;
  organizationId: string;
  branchId: string;
}
export function BranchServices({
  organizationId,
  branchId,
  serviceId,
}: Omit<Scope, 'userId'> & { serviceId?: string }) {
  return (
    <BranchAuthenticationBoundary>
      {(userId) => (
        <OwnedServices
          key={`${userId}:${organizationId}:${branchId}:${serviceId ?? 'list'}`}
          userId={userId}
          organizationId={organizationId}
          branchId={branchId}
          {...(serviceId ? { serviceId } : {})}
        />
      )}
    </BranchAuthenticationBoundary>
  );
}
function OwnedServices({ serviceId, ...scope }: Scope & { serviceId?: string }) {
  useBranchServiceCacheBoundary(scope.userId, scope.organizationId, scope.branchId);
  const organization = useOwnedOrganization(scope.userId, scope.organizationId);
  const branch = useOwnedBranch(scope.userId, scope.organizationId, scope.branchId);
  const { query, validId } = useBranchServices(
    scope.userId,
    scope.organizationId,
    scope.branchId,
    serviceId,
  );
  const path = `/business/organizations/${encodeURIComponent(scope.organizationId)}/branches/${encodeURIComponent(scope.branchId)}/services`;
  let content: ReactNode;
  if (!validId) content = <p role="alert">Invalid service address.</p>;
  else if (organization.query.isError || branch.query.isError)
    content = <BranchFailure error={organization.query.error ?? branch.query.error} />;
  else if (organization.query.isPending || branch.query.isPending || query.isPending)
    content = <p role="status">Loading services…</p>;
  else if (query.isError) content = <p role="alert">{serviceFailureMessage(query.error)}</p>;
  else
    content = (
      <>
        <p>
          {organization.query.data.organization.name} — {branch.query.data.branch.name}
        </p>
        <p>
          Active is a catalogue setting, not a guarantee of booking availability. Prices are fixed
          in KZT.
        </p>
        {!serviceId && <ServiceForm {...scope} />}
        {!query.data.services.length ? (
          <p>No services saved for this branch yet.</p>
        ) : (
          <ul aria-label="Branch services" className="organization-list">
            {query.data.services.map((service) => (
              <li key={service.id}>
                <h2>{service.name}</h2>
                {service.description && (
                  <p style={{ whiteSpace: 'pre-wrap' }}>{service.description}</p>
                )}
                <p>
                  {formatKztPrice(service.priceMinor)} · {service.durationMinutes} minutes
                </p>
                <p>
                  <span
                    className={`wash-box-badge${service.isActive ? '' : ' wash-box-badge--inactive'}`}
                  >
                    {service.isActive ? 'Active' : 'Inactive'}
                  </span>
                </p>
                {serviceId ? (
                  <ServiceManagement {...scope} service={service} />
                ) : (
                  <Link href={`${path}/${encodeURIComponent(service.id)}`}>
                    View {service.name}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  return (
    <section aria-label={serviceId ? 'Service details' : 'Services'}>
      {content}
      <p>
        <Link href={serviceId ? path : path.replace(/\/services$/, '')}>
          {serviceId ? 'Back to services' : 'Back to branch'}
        </Link>
      </p>
    </section>
  );
}
function ServiceForm({
  service,
  onComplete,
  onSaved,
  ...scope
}: Scope & { service?: PublicBranchService; onComplete?: () => void; onSaved?: () => void }) {
  const { mutation, submit } = useBranchServiceWrite(
    scope.userId,
    scope.organizationId,
    scope.branchId,
    service?.id,
  );
  const [fields, setFields] = useState<BranchServiceFields>(() =>
    service ? serviceEditFields(service) : emptyBranchServiceFields,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (service) form.current?.querySelector('input')?.focus();
  }, [service]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    setSuccess(false);
    const parsed = validateServiceForm(fields, service);
    setErrors(parsed.errors);
    if (parsed.result.success && (await submit(parsed.result.data))) {
      setFields(emptyBranchServiceFields);
      setSuccess(true);
      onSaved?.();
    }
  }
  return (
    <form
      ref={form}
      className="registration-form"
      aria-label={service ? 'Edit service' : 'Create service'}
      aria-busy={mutation.isPending}
      onSubmit={(event) => void save(event)}
      noValidate
    >
      <h3>{service ? 'Edit service' : 'Add service'}</h3>
      {(['name', 'description', 'durationMinutes', 'price'] as const).map((field) => {
        const id = `service-${service?.id ?? 'create'}-${field}`;
        const props = {
          id,
          value: fields[field],
          disabled: mutation.isPending,
          'aria-invalid': Boolean(errors[field]),
          'aria-describedby': errors[field] ? `${id}-error` : undefined,
          onChange: (event: { target: { value: string } }) => {
            setFields((current) => ({ ...current, [field]: event.target.value }));
            setSuccess(false);
          },
        };
        return (
          <div className="form-field" key={field}>
            <label htmlFor={id}>
              {field === 'name'
                ? 'Service name'
                : field === 'description'
                  ? 'Description (optional)'
                  : field === 'durationMinutes'
                    ? 'Duration (minutes)'
                    : 'Price (KZT)'}
            </label>
            {field === 'description' ? (
              <textarea {...props} />
            ) : (
              <input
                {...props}
                type="text"
                {...(field === 'price'
                  ? { inputMode: 'decimal' }
                  : field === 'durationMinutes'
                    ? { inputMode: 'numeric' }
                    : {})}
              />
            )}
            {errors[field] && (
              <p id={`${id}-error`} role="alert" className="field-error">
                {errors[field]}
              </p>
            )}
          </div>
        );
      })}
      {errors.form && <p role="alert">{errors.form}</p>}
      <button className="submit-button" disabled={mutation.isPending}>
        {mutation.isPending ? 'Saving service…' : service ? 'Save service' : 'Create service'}
      </button>
      {service && (
        <button
          type="button"
          className="secondary-button"
          disabled={mutation.isPending}
          onClick={onComplete}
        >
          Cancel
        </button>
      )}
      {mutation.isPending && <p role="status">Saving service…</p>}
      {mutation.isError && (
        <p role="alert">
          {service
            ? serviceFailureMessage(mutation.error)
            : serviceCreationFailureMessage(mutation.error)}
        </p>
      )}
      {success && <p role="status">Service created.</p>}
    </form>
  );
}
function ServiceManagement({ service, ...scope }: Scope & { service: PublicBranchService }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const editTrigger = useRef<HTMLButtonElement>(null);
  const activeTrigger = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const { mutation, submit } = useBranchServiceWrite(
    scope.userId,
    scope.organizationId,
    scope.branchId,
    service.id,
  );
  useEffect(() => {
    if (confirming) confirm.current?.focus();
  }, [confirming]);
  useEffect(() => {
    if (!editing && wasEditing.current) editTrigger.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  function endEdit() {
    setEditing(false);
    editTrigger.current?.focus();
  }
  async function setState(isActive: boolean) {
    setMessage('');
    if (await submit({ isActive })) {
      setConfirming(false);
      setMessage('Service activity saved.');
      activeTrigger.current?.focus();
    }
  }
  return (
    <div aria-busy={mutation.isPending}>
      <button
        ref={editTrigger}
        type="button"
        className="secondary-button"
        disabled={editing || confirming || mutation.isPending}
        onClick={() => {
          setMessage('');
          setEditing(true);
        }}
      >
        Edit service
      </button>
      {editing ? (
        <ServiceForm
          {...scope}
          service={service}
          onComplete={() => {
            endEdit();
          }}
          onSaved={() => {
            endEdit();
            setMessage('Service saved.');
          }}
        />
      ) : (
        <>
          <button
            ref={activeTrigger}
            type="button"
            className="secondary-button"
            disabled={mutation.isPending}
            onClick={() => {
              setMessage('');
              if (service.isActive) setConfirming(true);
              else void setState(true);
            }}
          >
            {service.isActive ? 'Deactivate service' : 'Reactivate service'}
          </button>
          {confirming && (
            <section aria-label="Confirm service deactivation">
              <p>Deactivate {service.name}? It will remain saved and editable.</p>
              <button
                ref={confirm}
                type="button"
                className="secondary-button destructive-button"
                disabled={mutation.isPending}
                onClick={() => void setState(false)}
              >
                Confirm deactivation
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={mutation.isPending}
                onClick={() => {
                  setConfirming(false);
                  activeTrigger.current?.focus();
                }}
              >
                Cancel
              </button>
            </section>
          )}
        </>
      )}
      {mutation.isPending && <p role="status">Saving service activity…</p>}
      {mutation.isError && <p role="alert">{serviceFailureMessage(mutation.error)}</p>}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
