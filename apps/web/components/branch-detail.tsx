'use client';
import { weekdays, type OpeningHoursEntry } from '@washqueue/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useOwnedBranch, useBranchWrite } from '@/hooks/use-branches';
import { changeOpeningStatus, unsavedClosedWeek, validateWeeklyForm } from '@/lib/branch-form';
import { BranchAuthenticationBoundary } from './branch-authentication-boundary';
import { BranchFailure } from './branches';

export function BranchDetail({
  organizationId,
  branchId,
}: {
  organizationId: string;
  branchId: string;
}) {
  return (
    <BranchAuthenticationBoundary>
      {(userId) => (
        <OwnedBranchDetail
          key={`${userId}:${organizationId}:${branchId}`}
          userId={userId}
          organizationId={organizationId}
          branchId={branchId}
        />
      )}
    </BranchAuthenticationBoundary>
  );
}
function OwnedBranchDetail({
  userId,
  organizationId,
  branchId,
}: {
  userId: string;
  organizationId: string;
  branchId: string;
}) {
  const { query, validId } = useOwnedBranch(userId, organizationId, branchId);
  return (
    <>
      {!validId ? (
        <p role="alert">Invalid branch address.</p>
      ) : query.isPending ? (
        <p role="status">Loading branch…</p>
      ) : query.isError ? (
        <BranchFailure error={query.error} />
      ) : (
        <section aria-label="Branch details">
          <h2>{query.data.branch.name}</h2>
          <dl>
            <dt>City</dt>
            <dd>{query.data.branch.city}</dd>
            <dt>Address</dt>
            <dd>{query.data.branch.addressLine}</dd>
            <dt>IANA time zone</dt>
            <dd>{query.data.branch.timeZone}</dd>
          </dl>
          <h3>Weekly opening hours</h3>
          <p>All hours are local wall-clock times in {query.data.branch.timeZone}.</p>
          {query.data.branch.openingHours.length === 0 ? (
            <p>Opening hours have not been configured.</p>
          ) : (
            <ul aria-label="Saved opening hours">
              {query.data.branch.openingHours.map((entry) => (
                <li key={entry.dayOfWeek}>
                  {entry.dayOfWeek}:{' '}
                  {entry.status === 'CLOSED'
                    ? 'Closed'
                    : entry.status === 'OPEN_24_HOURS'
                      ? 'Open 24 hours'
                      : `${entry.opensAt}–${entry.closesAt}${entry.closesNextDay ? ' (next day)' : ''}`}
                </li>
              ))}
            </ul>
          )}
          <WeeklyEditor
            userId={userId}
            organizationId={organizationId}
            branchId={branchId}
            saved={query.data.branch.openingHours}
          />
          <p>Wash boxes and services belong to later versions.</p>
        </section>
      )}
      <Link href={`/business/organizations/${encodeURIComponent(organizationId)}/branches`}>
        Back to branches
      </Link>
    </>
  );
}
function WeeklyEditor({
  userId,
  organizationId,
  branchId,
  saved,
}: {
  userId: string;
  organizationId: string;
  branchId: string;
  saved: OpeningHoursEntry[];
}) {
  const { mutation, submit } = useBranchWrite(userId, organizationId, branchId);
  const [entries, setEntries] = useState(() => (saved.length ? saved : unsavedClosedWeek()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  function change(index: number, patch: Partial<OpeningHoursEntry>) {
    setEntries((current) =>
      current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );
    setSuccess(false);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();
    setSuccess(false);
    const parsed = validateWeeklyForm(entries);
    setErrors(parsed.errors);
    if (parsed.result.success && (await submit(parsed.result.data))) {
      setEntries(parsed.result.data.openingHours);
      setSuccess(true);
    }
  }
  return (
    <form
      className="registration-form weekly-editor"
      aria-label="Weekly opening hours"
      aria-busy={mutation.isPending}
      noValidate
      onSubmit={(event) => void save(event)}
    >
      <h3>Configure weekly schedule</h3>
      {saved.length === 0 ? (
        <p>All Closed is an unsaved default. Save to configure the complete week.</p>
      ) : null}
      {entries.map((entry, index) => {
        const day = weekdays[index];
        const prefix = `hours-${day}`;
        const description = (field: string) =>
          errors[`${day}.${field}`] ? `${prefix}-${field}-error` : undefined;
        return (
          <fieldset key={day} disabled={mutation.isPending} className="weekday-row">
            <legend>{day}</legend>
            <div className="form-field">
              <label htmlFor={`${prefix}-status`}>{day} status</label>
              <select
                id={`${prefix}-status`}
                value={entry.status}
                aria-invalid={Boolean(errors[`${day}.status`])}
                aria-describedby={description('status')}
                onChange={(event) => {
                  const status = event.target.value;
                  if (status === 'OPEN' || status === 'CLOSED' || status === 'OPEN_24_HOURS')
                    change(index, changeOpeningStatus(entry, status));
                }}
              >
                <option value="CLOSED">Closed</option>
                <option value="OPEN">Open</option>
                <option value="OPEN_24_HOURS">Open 24 hours</option>
              </select>
            </div>
            {(['opensAt', 'closesAt'] as const).map((field) => (
              <div className="form-field" key={field}>
                <label htmlFor={`${prefix}-${field}`}>
                  {day} {field === 'opensAt' ? 'opening time' : 'closing time'}
                </label>
                <input
                  type="time"
                  id={`${prefix}-${field}`}
                  value={entry[field] ?? ''}
                  disabled={entry.status !== 'OPEN'}
                  aria-invalid={Boolean(errors[`${day}.${field}`])}
                  aria-describedby={description(field)}
                  onChange={(event) => change(index, { [field]: event.target.value })}
                />
              </div>
            ))}
            <label className="next-day-control">
              <input
                type="checkbox"
                checked={entry.closesNextDay}
                disabled={entry.status !== 'OPEN'}
                onChange={(event) => change(index, { closesNextDay: event.target.checked })}
              />
              {day} closes next day
            </label>
            {(['status', 'opensAt', 'closesAt', 'closesNextDay'] as const).map((field) =>
              errors[`${day}.${field}`] ? (
                <p key={field} id={`${prefix}-${field}-error`} className="field-error">
                  {errors[`${day}.${field}`]}
                </p>
              ) : null,
            )}
          </fieldset>
        );
      })}
      {errors.schedule ? <p role="alert">{errors.schedule}</p> : null}
      {mutation.isError ? <BranchFailure error={mutation.error} /> : null}
      <p role="status">
        {mutation.isPending ? 'Saving opening hours…' : success ? 'Opening hours saved.' : ''}
      </p>
      <button className="submit-button" disabled={mutation.isPending}>
        {mutation.isPending ? 'Saving…' : 'Save opening hours'}
      </button>
    </form>
  );
}
