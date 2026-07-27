'use client';

import { useMutation } from '@tanstack/react-query';
import { registrationRequestSchema, type RegistrationRequest } from '@washqueue/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ApiClientError, registerCustomer } from '@/lib/api-client';

type RegistrationField = keyof RegistrationRequest;
type FieldErrors = Partial<Record<RegistrationField, string>>;

const initialValues = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
};

export function RegistrationForm() {
  const [values, setValues] = useState(initialValues);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [passwordVisible, setPasswordVisible] = useState(false);
  const registration = useMutation({
    mutationFn: registerCustomer,
    onSuccess: () => {
      setValues((current) => ({ ...current, password: '' }));
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    registration.reset();

    const parsed = registrationRequestSchema.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error.issues));
      return;
    }

    setFieldErrors({});
    registration.mutate(parsed.data);
  }

  function updateField(field: RegistrationField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  if (registration.isSuccess) {
    return (
      <section className="registration-success" role="status" aria-live="polite">
        <p className="eyebrow">Account created</p>
        <h1>Welcome to WashQueue KZ</h1>
        <p>Your account has been created successfully. Login will be added in the next version.</p>
        <Link href="/">Return to the public home page</Link>
      </section>
    );
  }

  const duplicateEmail =
    registration.error instanceof ApiClientError &&
    (registration.error.status === 409 || registration.error.code === 'EMAIL_ALREADY_REGISTERED');

  return (
    <form className="registration-form" noValidate onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="firstName">First name</label>
        <input
          id="firstName"
          name="firstName"
          type="text"
          autoComplete="given-name"
          value={values.firstName}
          aria-invalid={Boolean(fieldErrors.firstName)}
          aria-describedby={fieldErrors.firstName ? 'firstName-error' : undefined}
          onChange={(event) => updateField('firstName', event.target.value)}
        />
        <FieldError id="firstName-error" message={fieldErrors.firstName} />
      </div>

      <div className="form-field">
        <label htmlFor="lastName">
          Last name <span>Optional</span>
        </label>
        <input
          id="lastName"
          name="lastName"
          type="text"
          autoComplete="family-name"
          value={values.lastName}
          aria-invalid={Boolean(fieldErrors.lastName)}
          aria-describedby={fieldErrors.lastName ? 'lastName-error' : undefined}
          onChange={(event) => updateField('lastName', event.target.value)}
        />
        <FieldError id="lastName-error" message={fieldErrors.lastName} />
      </div>

      <div className="form-field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={values.email}
          aria-invalid={Boolean(fieldErrors.email) || duplicateEmail}
          aria-describedby={
            fieldErrors.email ? 'email-error' : duplicateEmail ? 'registration-error' : undefined
          }
          onChange={(event) => updateField('email', event.target.value)}
        />
        <FieldError id="email-error" message={fieldErrors.email} />
      </div>

      <div className="form-field">
        <label htmlFor="password">Password</label>
        <div className="password-field">
          <input
            id="password"
            name="password"
            type={passwordVisible ? 'text' : 'password'}
            autoComplete="new-password"
            value={values.password}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? 'password-error' : 'password-hint'}
            onChange={(event) => updateField('password', event.target.value)}
          />
          <button
            type="button"
            className="password-visibility"
            aria-pressed={passwordVisible}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            {passwordVisible ? 'Hide' : 'Show'}
          </button>
        </div>
        <p id="password-hint" className="field-hint">
          Use 8–128 characters.
        </p>
        <FieldError id="password-error" message={fieldErrors.password} />
      </div>

      {registration.isError ? (
        <p id="registration-error" className="form-error" role="alert">
          {duplicateEmail
            ? 'An account with this email already exists.'
            : 'We could not create your account. Please try again.'}
        </p>
      ) : null}

      <button className="submit-button" type="submit" disabled={registration.isPending}>
        {registration.isPending ? 'Creating account…' : 'Create account'}
      </button>

      <Link className="home-link" href="/">
        Back to the public home page
      </Link>
    </form>
  );
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} className="field-error">
      {message}
    </p>
  ) : null;
}

function toFieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};

  for (const issue of issues) {
    const field = issue.path[0];
    if (
      typeof field === 'string' &&
      ['firstName', 'lastName', 'email', 'password'].includes(field) &&
      errors[field as RegistrationField] === undefined
    ) {
      errors[field as RegistrationField] = issue.message;
    }
  }

  return errors;
}
