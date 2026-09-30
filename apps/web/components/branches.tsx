'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useOwnedOrganization } from '@/hooks/use-organizations';
import { useOwnedBranches, useBranchWrite } from '@/hooks/use-branches';
import { emptyBranchForm, validateBranchForm } from '@/lib/branch-form';
import { ApiClientError } from '@/lib/api-client';
import { BranchAuthenticationBoundary } from './branch-authentication-boundary';

export function BranchFailure({ error }: { error: unknown }) {
  return (
    <p role="alert">
      {error instanceof ApiClientError && error.code === 'ORGANIZATION_NOT_FOUND'
        ? 'This organization is not available.'
        : error instanceof ApiClientError && error.code === 'BRANCH_NOT_FOUND'
          ? 'This branch is not available.'
          : 'We could not complete the branch request. Please try again.'}
    </p>
  );
}
export function Branches({ organizationId }: { organizationId: string }) {
  return (
    <BranchAuthenticationBoundary>
      {(userId) => (
        <OwnedBranches
          key={`${userId}:${organizationId}`}
          userId={userId}
          organizationId={organizationId}
        />
      )}
    </BranchAuthenticationBoundary>
  );
}
function OwnedBranches({ userId, organizationId }: { userId: string; organizationId: string }) {
  const organization = useOwnedOrganization(userId, organizationId);
  const { query, validId } = useOwnedBranches(userId, organizationId);
  return (
    <>
      {!validId ? (
        <p role="alert">Invalid organization address.</p>
      ) : organization.query.isError ? (
        <BranchFailure error={organization.query.error} />
      ) : organization.query.isPending ? (
        <p role="status">Loading your organization…</p>
      ) : query.isError ? (
        <BranchFailure error={query.error} />
      ) : (
        <>
          <h2>{organization.query.data.organization.name}</h2>
          <div className="organization-layout">
            <BranchCreateForm userId={userId} organizationId={organizationId} />
            <section aria-label="Organization branches" aria-busy={query.isPending}>
              <h2>Branches</h2>
              {query.isPending ? (
                <p role="status">Loading branches…</p>
              ) : query.data.branches.length === 0 ? (
                <p>No branches yet. Create your first branch.</p>
              ) : (
                <ul className="organization-list">
                  {query.data.branches.map((branch) => (
                    <li key={branch.id}>
                      <h3>
                        <Link
                          href={`/business/organizations/${organizationId}/branches/${branch.id}`}
                        >
                          {branch.name}
                        </Link>
                      </h3>
                      <p>
                        {branch.city} · {branch.addressLine}
                      </p>
                      <p>{branch.timeZone}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
      <Link href={`/business/organizations/${encodeURIComponent(organizationId)}`}>
        Back to organization
      </Link>
    </>
  );
}
function BranchCreateForm({ userId, organizationId }: { userId: string; organizationId: string }) {
  const { mutation, submit } = useBranchWrite(userId, organizationId);
  const [values, setValues] = useState(emptyBranchForm);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof values, string>>>({});
  const [success, setSuccess] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    setSuccess(false);
    const parsed = validateBranchForm(values);
    setErrors(parsed.errors);
    if (parsed.result.success && (await submit(parsed.result.data))) {
      setValues(emptyBranchForm);
      setSuccess(true);
    }
  }
  return (
    <section aria-labelledby="create-branch-heading">
      <h2 id="create-branch-heading">Create a branch</h2>
      <form
        className="registration-form"
        aria-label="Create branch"
        aria-busy={mutation.isPending}
        noValidate
        onSubmit={(event) => void save(event)}
      >
        {(
          [
            ['name', 'Branch name'],
            ['city', 'City'],
            ['addressLine', 'Address'],
            ['timeZone', 'IANA time zone'],
          ] as const
        ).map(([field, label]) => (
          <div className="form-field" key={field}>
            <label htmlFor={`branch-${field}`}>{label}</label>
            <input
              id={`branch-${field}`}
              value={values[field]}
              disabled={mutation.isPending}
              aria-invalid={Boolean(errors[field])}
              aria-describedby={
                errors[field]
                  ? `branch-${field}-error`
                  : field === 'timeZone'
                    ? 'time-zone-guidance'
                    : undefined
              }
              onChange={(event) => setValues({ ...values, [field]: event.target.value })}
            />
            {errors[field] ? (
              <p id={`branch-${field}-error`} className="field-error">
                {errors[field]}
              </p>
            ) : null}
          </div>
        ))}
        <p id="time-zone-guidance">
          Use an IANA identifier, for example Asia/Almaty. Hours are local branch times.
        </p>
        {mutation.isError ? <BranchFailure error={mutation.error} /> : null}
        <p role="status">
          {mutation.isPending ? 'Creating branch…' : success ? 'Branch created.' : ''}
        </p>
        <button className="submit-button" disabled={mutation.isPending}>
          {mutation.isPending ? 'Creating…' : 'Create branch'}
        </button>
      </form>
    </section>
  );
}
