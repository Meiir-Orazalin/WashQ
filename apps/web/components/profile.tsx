'use client';

import type { LoginUser } from '@washqueue/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useProfileUpdate } from '@/hooks/use-profile-update';
import {
  profileEditFields,
  validateProfileEdit,
  type ProfileEditField,
} from '@/lib/profile-edit-form';
import { useAuthentication } from '@/providers/authentication-provider';
import { LoginForm } from './login-form';

export function Profile() {
  const authentication = useAuthentication();
  if (authentication.status !== 'authenticated' || !authentication.currentUser) {
    return (
      <>
        {authentication.status === 'unauthenticated' ||
        authentication.status === 'authenticating' ? (
          <p role="status">Sign in to view and edit your profile.</p>
        ) : (
          <LoginForm />
        )}
        <nav className="form-links" aria-label="Profile account options">
          <Link href="/login">Sign in</Link>
          <Link href="/">Back to home</Link>
        </nav>
      </>
    );
  }
  return (
    <>
      <CurrentCustomerProfile
        key={authentication.currentUser.id}
        user={authentication.currentUser}
      />
      <nav className="authentication-actions" aria-label="Account options">
        <Link href="/vehicles">Your vehicles</Link>
        <Link href="/business/organizations">Your organizations</Link>
        <Link href="/login">Manage sign-in</Link>
        <button
          className="secondary-button"
          type="button"
          onClick={() => void authentication.logout()}
        >
          Sign out
        </button>
        <Link href="/">Back to home</Link>
      </nav>
    </>
  );
}

function CurrentCustomerProfile({ user }: { user: LoginUser }) {
  const [editing, setEditing] = useState(false);
  const [success, setSuccess] = useState(false);
  const interacted = useRef(false);
  const editButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!editing && interacted.current) editButton.current?.focus();
  }, [editing]);
  return (
    <section aria-label="Current profile">
      <dl className="profile-details">
        <dt>First name</dt>
        <dd>{user.firstName}</dd>
        {user.lastName !== null ? (
          <>
            <dt>Last name</dt>
            <dd>{user.lastName}</dd>
          </>
        ) : null}
        <dt>Email (read-only)</dt>
        <dd>{user.email}</dd>
      </dl>
      <p role="status">{success ? 'Profile updated.' : ''}</p>
      {editing ? (
        <ProfileEditForm
          user={user}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setSuccess(true);
            setEditing(false);
          }}
        />
      ) : (
        <button
          ref={editButton}
          className="secondary-button"
          type="button"
          onClick={() => {
            interacted.current = true;
            setSuccess(false);
            setEditing(true);
          }}
        >
          Edit profile
        </button>
      )}
    </section>
  );
}

function ProfileEditForm({
  user,
  onCancel,
  onSaved,
}: {
  user: LoginUser;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [initial] = useState(() => ({ firstName: user.firstName, lastName: user.lastName ?? '' }));
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<ProfileEditField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const { pending, failed, submit } = useProfileUpdate();
  useEffect(() => {
    firstInput.current?.focus();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = validateProfileEdit(initial, values);
    setErrors({});
    setFormError(null);
    if (!parsed.success) {
      const next: Partial<Record<ProfileEditField, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = profileEditFields.find(({ name }) => name === issue.path[0]);
        if (field && !next[field.name]) next[field.name] = issue.message;
        else if (issue.path.length === 0) setFormError('Change at least one name before saving.');
      }
      setErrors(next);
      return;
    }
    if (await submit(parsed.data)) onSaved();
  }

  return (
    <form
      className="registration-form"
      aria-label="Edit profile"
      noValidate
      aria-busy={pending}
      onSubmit={(event) => void handleSubmit(event)}
    >
      {profileEditFields.map(({ name, label, autoComplete }) => (
        <div className="form-field" key={name}>
          <label htmlFor={`profile-${name}`}>{label}</label>
          <input
            id={`profile-${name}`}
            ref={name === 'firstName' ? firstInput : undefined}
            name={name}
            autoComplete={autoComplete}
            value={values[name]}
            disabled={pending}
            aria-invalid={Boolean(errors[name])}
            aria-describedby={errors[name] ? `profile-${name}-error` : undefined}
            onChange={(event) => {
              setValues((current) => ({ ...current, [name]: event.target.value }));
              setErrors((current) => ({ ...current, [name]: undefined }));
              setFormError(null);
            }}
          />
          {errors[name] ? (
            <p className="field-error" id={`profile-${name}-error`}>
              {errors[name]}
            </p>
          ) : null}
        </div>
      ))}
      <div className="form-field">
        <label htmlFor="profile-email">Email (read-only)</label>
        <input
          id="profile-email"
          type="email"
          value={user.email}
          readOnly
          aria-describedby="profile-email-help"
        />
        <p id="profile-email-help">Email cannot be changed here.</p>
      </div>
      {formError || failed ? (
        <p className="form-error" role="alert">
          {formError ?? 'We could not update your profile. Please try again.'}
        </p>
      ) : null}
      <p role="status">{pending ? 'Saving your profile…' : ''}</p>
      <div className="authentication-actions">
        <button className="submit-button" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button className="secondary-button" type="button" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
