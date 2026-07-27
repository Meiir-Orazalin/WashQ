import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RegistrationForm } from './registration-form';

const successResponse = {
  user: {
    id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
    firstName: 'Meiir',
    lastName: 'Orazalin',
    email: 'meiir@example.com',
    createdAt: '2026-07-27T12:00:00.000Z',
  },
};

function renderForm() {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <RegistrationForm />
    </QueryClientProvider>,
  );
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Meiir' } });
  fireEvent.change(screen.getByLabelText(/Last name/), { target: { value: 'Orazalin' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'meiir@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'example-password' },
  });
}

describe('RegistrationForm', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders accessible registration fields and actions', () => {
    renderForm();

    expect(screen.getByLabelText('First name')).toHaveAttribute('autocomplete', 'given-name');
    expect(screen.getByLabelText(/Last name/)).toHaveAttribute('autocomplete', 'family-name');
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Back to the public home page' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('shows field-level validation errors', () => {
    renderForm();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'M' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'invalid' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('First name must contain at least 2 characters')).toBeVisible();
    expect(screen.getByText('Enter a valid email address')).toBeVisible();
    expect(screen.getByText('Password must contain at least 8 characters')).toBeVisible();
  });

  it('disables submission and shows a loading state while pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>(() => undefined)),
    );
    renderForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const pendingButton = await screen.findByRole('button', { name: 'Creating account…' });
    expect(pendingButton).toBeDisabled();
  });

  it('shows the required success state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successResponse), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    renderForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText(
        'Your account has been created successfully. Login will be added in the next version.',
      ),
    ).toBeVisible();
  });

  it('shows a clear duplicate-email state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'EMAIL_ALREADY_REGISTERED',
              message: 'An account with this email already exists',
            },
            timestamp: '2026-07-27T12:00:00.000Z',
            path: '/api/v1/auth/register',
            requestId: 'request-id',
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    renderForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('An account with this email already exists.')).toBeVisible();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a general server-error state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    renderForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('We could not create your account. Please try again.'),
    ).toBeVisible();
  });

  it('toggles password visibility without changing the entered password', () => {
    renderForm();
    const password = screen.getByLabelText('Password');
    fireEvent.change(password, { target: { value: 'example-password' } });

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('example-password');

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('example-password');
  });

  it('never writes the password to browser storage', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successResponse), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    renderForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(screen.getByText('Welcome to WashQueue KZ')).toBeVisible());

    expect(storageWrite).not.toHaveBeenCalled();
  });
});
