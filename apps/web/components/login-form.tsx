'use client';

import { loginRequestSchema, type LoginRequest } from '@washqueue/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SessionEstablishmentError, useLoginMutation } from '@/hooks/use-login-mutation';
import { ApiClientError } from '@/lib/api-client';
import { useAuthentication } from '@/providers/authentication-provider';

type LoginField = keyof LoginRequest;
type FieldErrors = Partial<Record<LoginField, string>>;

const initialValues: LoginRequest = {
  email: '',
  password: '',
};

export function LoginForm() {
  const [values, setValues] = useState(initialValues);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [explicitLoginStarted, setExplicitLoginStarted] = useState(false);
  const formError = useRef<HTMLParagraphElement>(null);
  const authentication = useAuthentication();
  const login = useLoginMutation();

  useEffect(() => {
    if (login.isError) {
      setValues((current) => ({ ...current, password: '' }));
      formError.current?.focus();
    }
  }, [login.isError]);

  useEffect(() => {
    if (authentication.status === 'authenticated') {
      setValues((current) => ({ ...current, password: '' }));
      setExplicitLoginStarted(false);
    }
  }, [authentication.status]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (login.isPending) {
      return;
    }

    login.reset();
    const parsed = loginRequestSchema.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error.issues));
      return;
    }

    setFieldErrors({});
    setExplicitLoginStarted(true);
    login.authenticate(parsed.data);
  }

  function updateField(field: LoginField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  function continueAfterCoordinationError() {
    login.reset();
    setExplicitLoginStarted(false);
    authentication.continueUnauthenticated();
  }

  if (authentication.status === 'initializing') {
    return (
      <section className="session-status" role="status" aria-live="polite" aria-busy="true">
        <p className="eyebrow">Session check</p>
        <h2>Restoring your session…</h2>
        <p>Please wait while we securely check your existing browser session.</p>
      </section>
    );
  }

  if (authentication.status === 'coordination-error') {
    return (
      <section className="session-status session-status--error" role="alert">
        <p className="eyebrow">Session coordination unavailable</p>
        <h2>We could not safely coordinate your session</h2>
        <p>
          Your browser could not safely coordinate the sign-in session. Please update your browser
          or close other open tabs and try again.
        </p>
        <button className="submit-button" type="button" onClick={continueAfterCoordinationError}>
          Continue to sign in
        </button>
      </section>
    );
  }

  if (authentication.status === 'authenticated' && authentication.currentUser) {
    const displayName = [authentication.currentUser.firstName, authentication.currentUser.lastName]
      .filter(Boolean)
      .join(' ');

    return (
      <section className="authentication-success" role="status" aria-live="polite">
        <p className="eyebrow">Authenticated</p>
        <h2>You are signed in</h2>
        <p>
          Signed in as <strong>{displayName}</strong>
        </p>
        <p className="authenticated-email">{authentication.currentUser.email}</p>
        <p>Full customer dashboard functionality will be added in a later version.</p>
        <div className="authentication-actions">
          <button
            className="submit-button"
            type="button"
            onClick={() => void authentication.logout()}
          >
            Sign out
          </button>
          <Link href="/">Return to the public home page</Link>
        </div>
      </section>
    );
  }

  if (authentication.status === 'logging-out') {
    return (
      <section className="session-status" role="status" aria-live="polite" aria-busy="true">
        <p className="eyebrow">Signing out</p>
        <h2>Clearing your session…</h2>
        <p>Please wait while we confirm sign-out with the server.</p>
        <button className="submit-button" type="button" disabled>
          Signing out…
        </button>
      </section>
    );
  }

  if (authentication.status === 'logout-error') {
    return (
      <section className="session-status session-status--error" role="alert">
        <p className="eyebrow">Sign-out not confirmed</p>
        <h2>Please retry sign-out</h2>
        <p>
          We cleared this page’s session, but could not confirm sign-out with the server. Please
          retry before leaving this device.
        </p>
        <div className="authentication-actions">
          <button
            className="submit-button"
            type="button"
            onClick={() => void authentication.logout()}
          >
            Retry sign out
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={authentication.continueAfterLogoutError}
          >
            Continue to sign in
          </button>
        </div>
      </section>
    );
  }

  if (
    authentication.status === 'error' &&
    !explicitLoginStarted &&
    !login.isPending &&
    !login.isError
  ) {
    return (
      <section className="session-status session-status--error" role="alert">
        <p className="eyebrow">Session unavailable</p>
        <h2>We could not restore your session</h2>
        <p>We could not restore your session. You can continue by signing in again.</p>
        <button
          className="submit-button"
          type="button"
          onClick={authentication.continueUnauthenticated}
        >
          Continue to sign in
        </button>
      </section>
    );
  }

  const invalidCredentials =
    login.error instanceof ApiClientError &&
    (login.error.status === 401 || login.error.code === 'INVALID_CREDENTIALS');
  const sessionEstablishmentFailed = login.error instanceof SessionEstablishmentError;

  return (
    <form className="registration-form" noValidate aria-busy={login.isPending} onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={values.email}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
          onChange={(event) => updateField('email', event.target.value)}
        />
        <FieldError id="login-email-error" message={fieldErrors.email} />
      </div>

      <div className="form-field">
        <label htmlFor="login-password">Password</label>
        <div className="password-field">
          <input
            id="login-password"
            name="password"
            type={passwordVisible ? 'text' : 'password'}
            autoComplete="current-password"
            value={values.password}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
            onChange={(event) => updateField('password', event.target.value)}
          />
          <button
            type="button"
            className="password-visibility"
            aria-label={passwordVisible ? 'Hide password' : 'Show password'}
            aria-pressed={passwordVisible}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            {passwordVisible ? 'Hide' : 'Show'}
          </button>
        </div>
        <FieldError id="login-password-error" message={fieldErrors.password} />
      </div>

      {login.isError ? (
        <p id="login-error" className="form-error" role="alert" tabIndex={-1} ref={formError}>
          {invalidCredentials
            ? 'Email or password is incorrect.'
            : sessionEstablishmentFailed
              ? 'We could not establish your session. Please sign in again.'
              : 'We could not sign you in. Please try again.'}
        </p>
      ) : null}

      <p className="visually-hidden" role="status" aria-live="polite">
        {login.isPending ? 'Signing in. Please wait.' : ''}
      </p>

      <button className="submit-button" type="submit" disabled={login.isPending}>
        {login.isPending ? 'Signing in…' : 'Sign in'}
      </button>

      <nav className="form-links" aria-label="Login options">
        <Link href="/register">Create an account</Link>
        <Link href="/">Back to the public home page</Link>
      </nav>
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
      ['email', 'password'].includes(field) &&
      errors[field as LoginField] === undefined
    ) {
      errors[field as LoginField] = issue.message;
    }
  }

  return errors;
}
