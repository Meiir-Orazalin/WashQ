'use client';
import type { PublicWashBox } from '@washqueue/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useOwnedBranch } from '@/hooks/use-branches';
import { useOwnedOrganization } from '@/hooks/use-organizations';
import { useWashBoxes, useWashBoxWrite, useWashBoxCacheBoundary } from '@/hooks/use-wash-boxes';
import { validateWashBoxNumber, washBoxFailureMessage } from '@/lib/wash-box-form';
import { BranchAuthenticationBoundary } from './branch-authentication-boundary';
import { BranchFailure } from './branches';

export function WashBoxes({
  organizationId,
  branchId,
  washBoxId,
}: {
  organizationId: string;
  branchId: string;
  washBoxId?: string;
}) {
  return (
    <BranchAuthenticationBoundary>
      {(userId) => (
        <OwnedWashBoxes
          key={`${userId}:${organizationId}:${branchId}:${washBoxId ?? 'list'}`}
          userId={userId}
          organizationId={organizationId}
          branchId={branchId}
          {...(washBoxId ? { washBoxId } : {})}
        />
      )}
    </BranchAuthenticationBoundary>
  );
}
function OwnedWashBoxes({
  userId,
  organizationId,
  branchId,
  washBoxId,
}: {
  userId: string;
  organizationId: string;
  branchId: string;
  washBoxId?: string;
}) {
  useWashBoxCacheBoundary(userId, organizationId, branchId);
  const organization = useOwnedOrganization(userId, organizationId);
  const branch = useOwnedBranch(userId, organizationId, branchId);
  const { query, validId } = useWashBoxes(userId, organizationId, branchId, washBoxId);
  const path = `/business/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/wash-boxes`;
  let content: ReactNode;
  if (!validId) content = <p role="alert">Invalid wash box address.</p>;
  else if (organization.query.isError || branch.query.isError)
    content = <BranchFailure error={organization.query.error ?? branch.query.error} />;
  else if (organization.query.isPending || branch.query.isPending || query.isPending)
    content = <p role="status">Loading wash boxes…</p>;
  else if (query.isError) content = <p role="alert">{washBoxFailureMessage(query.error)}</p>;
  else
    content = (
      <>
        <p>
          {organization.query.data.organization.name} — {branch.query.data.branch.name}
        </p>
        <p>
          Active is a configuration setting, not a real-time free or busy indicator. Inactive boxes
          remain saved and keep their number.
        </p>
        {!washBoxId && (
          <CreateBoxForm userId={userId} organizationId={organizationId} branchId={branchId} />
        )}
        {!query.data.washBoxes.length ? (
          <p>No wash boxes saved for this branch yet.</p>
        ) : (
          <ul aria-label="Branch wash boxes" className="organization-list">
            {query.data.washBoxes.map((box) => (
              <li key={box.id}>
                <h2>Box {box.number}</h2>
                <p>
                  <span
                    className={`wash-box-badge${box.isActive ? '' : ' wash-box-badge--inactive'}`}
                  >
                    {box.isActive ? 'Active' : 'Inactive'}
                  </span>
                </p>
                {!washBoxId && (
                  <Link href={`${path}/${encodeURIComponent(box.id)}`}>View Box {box.number}</Link>
                )}
                <BoxActiveControl
                  key={box.id}
                  userId={userId}
                  organizationId={organizationId}
                  branchId={branchId}
                  box={box}
                />
              </li>
            ))}
          </ul>
        )}
      </>
    );
  return (
    <section aria-label={washBoxId ? 'Wash box details' : 'Wash boxes'}>
      {content}
      <p>
        <Link href={washBoxId ? path : path.replace(/\/wash-boxes$/, '')}>
          {washBoxId ? 'Back to wash boxes' : 'Back to branch'}
        </Link>
      </p>
    </section>
  );
}
function CreateBoxForm({
  userId,
  organizationId,
  branchId,
}: {
  userId: string;
  organizationId: string;
  branchId: string;
}) {
  const { mutation, submit } = useWashBoxWrite(userId, organizationId, branchId);
  const [number, setNumber] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    const parsed = validateWashBoxNumber(number);
    setSuccess(false);
    setError('');
    if (!parsed.success) {
      setError('Enter a whole box number from 1 to 999.');
      return;
    }
    if (await submit(parsed.data)) {
      setNumber('');
      setSuccess(true);
    }
  }
  return (
    <form
      onSubmit={create}
      noValidate
      className="registration-form wash-box-form"
      aria-label="Create wash box"
      aria-busy={mutation.isPending}
    >
      <h2>Add wash box</h2>
      <div className="form-field">
        <label htmlFor="box-number">Box number</label>
        <input
          id="box-number"
          type="number"
          inputMode="numeric"
          min="1"
          max="999"
          step="1"
          value={number}
          onChange={(event) => {
            setNumber(event.target.value);
            setSuccess(false);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'box-number-error' : 'box-number-hint'}
          disabled={mutation.isPending}
        />
        <p id="box-number-hint">Whole number from 1 to 999, unique within this branch.</p>
        {error && (
          <p id="box-number-error" role="alert" className="field-error">
            {error}
          </p>
        )}
      </div>
      <button type="submit" className="submit-button" disabled={mutation.isPending}>
        {mutation.isPending ? 'Creating box…' : 'Create box'}
      </button>
      {mutation.isPending && <p role="status">Creating wash box…</p>}
      {mutation.isError && <p role="alert">{washBoxFailureMessage(mutation.error)}</p>}
      {success && <p role="status">Wash box created.</p>}
    </form>
  );
}
function BoxActiveControl({
  userId,
  organizationId,
  branchId,
  box,
}: {
  userId: string;
  organizationId: string;
  branchId: string;
  box: PublicWashBox;
}) {
  const { mutation, submit } = useWashBoxWrite(userId, organizationId, branchId, box.id);
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirm.current?.focus();
  }, [confirming]);
  function cancel() {
    setConfirming(false);
    trigger.current?.focus();
  }
  async function setState(isActive: boolean) {
    setSuccess(false);
    if (await submit({ isActive })) {
      setConfirming(false);
      setSuccess(true);
      trigger.current?.focus();
    }
  }
  return (
    <div aria-busy={mutation.isPending}>
      <button
        ref={trigger}
        className="secondary-button"
        type="button"
        disabled={mutation.isPending}
        aria-label={`${box.isActive ? 'Disable' : 'Enable'} Box ${box.number}`}
        onClick={() => {
          setSuccess(false);
          if (box.isActive) setConfirming(true);
          else void setState(true);
        }}
      >
        {box.isActive ? 'Disable' : 'Enable'}
      </button>
      {confirming && (
        <section aria-label={`Confirm deactivation of Box ${box.number}`}>
          <p>Deactivate Box {box.number}? It will remain saved and keep its number.</p>
          <button
            ref={confirm}
            className="secondary-button destructive-button"
            type="button"
            disabled={mutation.isPending}
            onClick={() => void setState(false)}
          >
            Confirm deactivation
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={mutation.isPending}
            onClick={cancel}
          >
            Cancel
          </button>
        </section>
      )}
      {mutation.isPending && <p role="status">Saving box activity…</p>}
      {mutation.isError && <p role="alert">{washBoxFailureMessage(mutation.error)}</p>}
      {success && <p role="status">Box activity saved.</p>}
    </div>
  );
}
