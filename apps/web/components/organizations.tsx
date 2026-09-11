'use client';

import { createOrganizationRequestSchema } from '@washqueue/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useOwnedOrganizations } from '@/hooks/use-organizations';
import { OrganizationAuthenticationBoundary } from './organization-authentication-boundary';

export function Organizations() {
  return (
    <OrganizationAuthenticationBoundary>
      {(userId) => <OwnedOrganizations userId={userId} />}
    </OrganizationAuthenticationBoundary>
  );
}
function OwnedOrganizations({ userId }: { userId: string }) {
  const { query, mutation, submit } = useOwnedOrganizations(userId);
  const [values, setValues] = useState({ name: '', description: '' });
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({});
  const [success, setSuccess] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    setSuccess(false);
    const parsed = createOrganizationRequestSchema.safeParse(values);
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'name' && !next.name) next.name = issue.message;
        if (issue.path[0] === 'description' && !next.description) next.description = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    if (await submit(parsed.data)) {
      setValues({ name: '', description: '' });
      setSuccess(true);
    }
  }
  return (
    <div className="organization-layout">
      <section aria-labelledby="create-organization-heading">
        <h2 id="create-organization-heading">Create an organization</h2>
        <form
          className="registration-form"
          noValidate
          aria-label="Create organization"
          aria-busy={mutation.isPending}
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div className="form-field">
            <label htmlFor="organization-name">Organization name</label>
            <input
              id="organization-name"
              value={values.name}
              disabled={mutation.isPending}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'organization-name-error' : undefined}
              onChange={(event) => {
                setValues({ ...values, name: event.target.value });
                setErrors((current) => {
                  const next = { ...current };
                  delete next.name;
                  return next;
                });
              }}
            />
            {errors.name ? (
              <p className="field-error" id="organization-name-error">
                {errors.name}
              </p>
            ) : null}
          </div>
          <div className="form-field">
            <label htmlFor="organization-description">Description (optional)</label>
            <textarea
              id="organization-description"
              rows={5}
              value={values.description}
              disabled={mutation.isPending}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? 'organization-description-error' : undefined}
              onChange={(event) => {
                setValues({ ...values, description: event.target.value });
                setErrors((current) => {
                  const next = { ...current };
                  delete next.description;
                  return next;
                });
              }}
            />
            {errors.description ? (
              <p className="field-error" id="organization-description-error">
                {errors.description}
              </p>
            ) : null}
          </div>
          {mutation.isError ? (
            <p role="alert" className="form-error">
              We could not create your organization. Please try again.
            </p>
          ) : null}
          <p role="status">
            {mutation.isPending
              ? 'Creating your organization…'
              : success
                ? 'Organization created.'
                : ''}
          </p>
          <button className="submit-button" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create organization'}
          </button>
        </form>
      </section>
      <section aria-labelledby="owned-organizations-heading" aria-busy={query.isPending}>
        <h2 id="owned-organizations-heading">Your organizations</h2>
        {query.isPending ? (
          <p role="status">Loading your organizations…</p>
        ) : query.isError ? (
          <p role="alert">We could not load your organizations.</p>
        ) : query.data.organizations.length === 0 ? (
          <p>No organizations yet. Create your first organization.</p>
        ) : (
          <ul className="organization-list">
            {query.data.organizations.map((organization) => (
              <li key={organization.id}>
                <h3>
                  <Link href={`/business/organizations/${organization.id}`}>
                    {organization.name}
                  </Link>
                </h3>
                {organization.description ? (
                  <p className="organization-description">{organization.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
