import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateOrganizationUseCase } from '../src/organizations/application/create-organization.use-case.js';
import { ListOwnedOrganizationsUseCase } from '../src/organizations/application/list-owned-organizations.use-case.js';
import { GetOwnedOrganizationUseCase } from '../src/organizations/application/get-owned-organization.use-case.js';
import {
  OrganizationNotFoundError,
  type OrganizationRepository,
} from '../src/organizations/application/organization.repository.js';
import { mapOrganizationResponse } from '../src/organizations/presentation/organization-response.mapper.js';

const userId = '10abed8b-ed56-4744-90ae-48e9c75fab37';
const organization = {
  id: 'de33c359-79fb-482a-9034-00b63d1c9024',
  name: 'Wash',
  description: null,
  createdAt: new Date('2026-09-11T00:00:00Z'),
  updatedAt: new Date('2026-09-11T00:00:00Z'),
};
describe('organization application boundaries', () => {
  let repository: OrganizationRepository;
  beforeEach(() => {
    repository = {
      createWithOwnerMembership: vi.fn().mockResolvedValue(organization),
      listOwnedByUser: vi.fn().mockResolvedValue([organization]),
      findOwnedById: vi.fn().mockResolvedValue(organization),
    };
  });
  it('passes only normalized input and separately trusted identity to atomic creation', async () => {
    expect(
      await new CreateOrganizationUseCase(repository).execute(userId, {
        name: ' Ｗash ',
        description: ' ',
      }),
    ).toEqual(organization);
    expect(repository.createWithOwnerMembership).toHaveBeenCalledExactlyOnceWith(userId, {
      name: 'Wash',
      description: null,
    });
    expect(repository.findOwnedById).not.toHaveBeenCalled();
  });
  it('rejects an attempted owner selection before persistence', () => {
    const input = { name: 'Wash', userId: 'untrusted' };
    expect(() => new CreateOrganizationUseCase(repository).execute(userId, input)).toThrow();
    expect(repository.createWithOwnerMembership).not.toHaveBeenCalled();
  });
  it('delegates owner-filtered deterministic list order unchanged', async () => {
    const second = { ...organization, id: '11111111-1111-4111-8111-111111111111' };
    vi.mocked(repository.listOwnedByUser).mockResolvedValue([organization, second]);
    expect(await new ListOwnedOrganizationsUseCase(repository).execute(userId)).toEqual([
      organization,
      second,
    ]);
    expect(repository.listOwnedByUser).toHaveBeenCalledExactlyOnceWith(userId);
  });
  it('supports an empty owned list', async () => {
    vi.mocked(repository.listOwnedByUser).mockResolvedValue([]);
    expect(await new ListOwnedOrganizationsUseCase(repository).execute(userId)).toEqual([]);
  });
  it('uses both identity and organization ID for detail', async () => {
    expect(
      await new GetOwnedOrganizationUseCase(repository).execute(userId, organization.id),
    ).toEqual(organization);
    expect(repository.findOwnedById).toHaveBeenCalledExactlyOnceWith(userId, organization.id);
  });
  it.each(['missing', 'foreign'])(
    'maps %s to the same public-independent not-found error',
    async () => {
      vi.mocked(repository.findOwnedById).mockResolvedValue(null);
      await expect(
        new GetOwnedOrganizationUseCase(repository).execute(userId, organization.id),
      ).rejects.toThrow(OrganizationNotFoundError);
    },
  );
  it('rejects malformed UUID before persistence', async () => {
    await expect(
      new GetOwnedOrganizationUseCase(repository).execute(userId, 'bad'),
    ).rejects.toThrow();
    expect(repository.findOwnedById).not.toHaveBeenCalled();
  });
  it('explicitly maps public fields without membership or ownership internals', () => {
    const response = mapOrganizationResponse({
      ...organization,
      ...{ userId, membershipId: 'internal', role: 'OWNER' },
    });
    expect(Object.keys(response).sort()).toEqual([
      'createdAt',
      'description',
      'id',
      'name',
      'updatedAt',
    ]);
  });
  it.each(['create', 'list', 'detail'])(
    'propagates unexpected %s infrastructure failure to sanitized HTTP boundary',
    async (operation) => {
      const failure = new Error('private persistence failure');
      vi.mocked(repository.createWithOwnerMembership).mockRejectedValue(failure);
      vi.mocked(repository.listOwnedByUser).mockRejectedValue(failure);
      vi.mocked(repository.findOwnedById).mockRejectedValue(failure);
      const result =
        operation === 'create'
          ? new CreateOrganizationUseCase(repository).execute(userId, { name: 'Wash' })
          : operation === 'list'
            ? new ListOwnedOrganizationsUseCase(repository).execute(userId)
            : new GetOwnedOrganizationUseCase(repository).execute(userId, organization.id);
      await expect(result).rejects.toBe(failure);
    },
  );
});
