import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { weekdays } from '@washqueue/contracts';
import { CurrentOrganizationOwnerAccess } from '../src/organizations/application/organization-owner-access.js';
import { OrganizationNotFoundError } from '../src/organizations/public.js';
import type { OrganizationRepository } from '../src/organizations/application/organization.repository.js';
import { CreateBranchUseCase } from '../src/branches/application/create-branch.use-case.js';
import { ListOwnedOrganizationBranchesUseCase } from '../src/branches/application/list-owned-organization-branches.use-case.js';
import { GetOwnedBranchUseCase } from '../src/branches/application/get-owned-branch.use-case.js';
import { ReplaceBranchOpeningHoursUseCase } from '../src/branches/application/replace-branch-opening-hours.use-case.js';
import {
  BranchNotFoundError,
  type BranchRepository,
} from '../src/branches/application/branch.repository.js';
import {
  mapBranchResponse,
  mapOpeningHoursResponse,
} from '../src/branches/presentation/branch-response.mapper.js';
const organizationId = '00000000-0000-4000-8000-000000000001';
const branchId = '00000000-0000-4000-8000-000000000002';
const values = {
  name: 'Branch',
  city: 'Astana',
  addressLine: 'Address 12',
  timeZone: 'Asia/Almaty',
};
const branch = {
  id: branchId,
  ...values,
  createdAt: new Date(),
  updatedAt: new Date(),
  openingHours: [],
};
const schedule = weekdays.map((dayOfWeek) => ({
  dayOfWeek,
  status: 'OPEN' as const,
  opensAt: '22:00',
  closesAt: '02:00',
  closesNextDay: true,
}));
function setup() {
  const access = { assertCurrentOwner: vi.fn().mockResolvedValue(undefined) };
  const repository: BranchRepository = {
    createBranch: vi.fn().mockResolvedValue(branch),
    listBranchesByOrganization: vi.fn().mockResolvedValue([branch]),
    findBranchByOrganizationAndId: vi.fn().mockResolvedValue(branch),
    replaceOpeningHours: vi
      .fn()
      .mockImplementation(
        async (_org, _id, entries: Parameters<BranchRepository['replaceOpeningHours']>[2]) =>
          entries,
      ),
  };
  return { access, repository };
}
describe('organization public owner access', () => {
  it('returns no membership/persistence data and derives access from owned query', async () => {
    const repository = {
      findOwnedById: vi.fn().mockResolvedValue({ id: organizationId }),
    } as unknown as OrganizationRepository;
    expect(
      await new CurrentOrganizationOwnerAccess(repository).assertCurrentOwner(
        'verified',
        organizationId,
      ),
    ).toBeUndefined();
    expect(repository.findOwnedById).toHaveBeenCalledExactlyOnceWith('verified', organizationId);
  });
  for (const state of ['missing', 'foreign'])
    it(`${state} uses identical organization not found`, async () => {
      const repository = {
        findOwnedById: vi.fn().mockResolvedValue(null),
      } as unknown as OrganizationRepository;
      await expect(
        new CurrentOrganizationOwnerAccess(repository).assertCurrentOwner(
          'verified',
          organizationId,
        ),
      ).rejects.toThrow(OrganizationNotFoundError);
    });
  it('branches imports only public organization access and composition, never persistence', () => {
    function inspect(directory: URL) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
        if (entry.isDirectory()) inspect(path);
        else if (entry.name.endsWith('.ts')) {
          const source = readFileSync(path, 'utf8');
          expect(source).not.toMatch(
            /organizationMembership|organization_memberships|PrismaOrganizationRepository|organizations\/(?:infrastructure|application|domain|presentation)/,
          );
        }
      }
    }
    inspect(new URL('../src/branches/', import.meta.url));
  });
});
describe('branch use cases', () => {
  it('checks verified owner before normalized creation and scopes persistence', async () => {
    const { access, repository } = setup();
    const result = await new CreateBranchUseCase(access, repository).execute(
      'verified',
      organizationId,
      { ...values, name: ' Ｂranch ', city: ' Astana ' },
    );
    expect(access.assertCurrentOwner).toHaveBeenCalledExactlyOnceWith('verified', organizationId);
    expect(repository.createBranch).toHaveBeenCalledExactlyOnceWith(organizationId, values);
    expect(vi.mocked(access.assertCurrentOwner).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(repository.createBranch).mock.invocationCallOrder[0] ?? 0,
    );
    expect(mapBranchResponse(result)).not.toHaveProperty('organizationId');
  });
  it('lists only the requested organization and preserves ordered/empty repository results', async () => {
    const { access, repository } = setup();
    expect(
      await new ListOwnedOrganizationBranchesUseCase(access, repository).execute(
        'verified',
        organizationId,
      ),
    ).toEqual([branch]);
    expect(repository.listBranchesByOrganization).toHaveBeenCalledWith(organizationId);
    vi.mocked(repository.listBranchesByOrganization).mockResolvedValue([]);
    expect(
      await new ListOwnedOrganizationBranchesUseCase(access, repository).execute(
        'verified',
        organizationId,
      ),
    ).toEqual([]);
  });
  it('returns unconfigured detail scoped by both organization and branch', async () => {
    const { access, repository } = setup();
    expect(
      (
        await new GetOwnedBranchUseCase(access, repository).execute(
          'verified',
          organizationId,
          branchId,
        )
      ).openingHours,
    ).toEqual([]);
    expect(repository.findBranchByOrganizationAndId).toHaveBeenCalledExactlyOnceWith(
      organizationId,
      branchId,
    );
  });
  for (const operation of ['create', 'list', 'detail', 'schedule'])
    it(`denied owner stops ${operation} persistence`, async () => {
      const { access, repository } = setup();
      access.assertCurrentOwner.mockRejectedValue(new OrganizationNotFoundError());
      const promise =
        operation === 'create'
          ? new CreateBranchUseCase(access, repository).execute('verified', organizationId, values)
          : operation === 'list'
            ? new ListOwnedOrganizationBranchesUseCase(access, repository).execute(
                'verified',
                organizationId,
              )
            : operation === 'detail'
              ? new GetOwnedBranchUseCase(access, repository).execute(
                  'verified',
                  organizationId,
                  branchId,
                )
              : new ReplaceBranchOpeningHoursUseCase(access, repository).execute(
                  'verified',
                  organizationId,
                  branchId,
                  { openingHours: schedule },
                );
      await expect(promise).rejects.toThrow(OrganizationNotFoundError);
      for (const method of Object.values(repository)) expect(method).not.toHaveBeenCalled();
    });
  it('canonicalizes schedule and maps exact local HH:mm to/from minutes', async () => {
    const { access, repository } = setup();
    const result = await new ReplaceBranchOpeningHoursUseCase(access, repository).execute(
      'verified',
      organizationId,
      branchId,
      { openingHours: [...schedule].reverse() },
    );
    expect(repository.replaceOpeningHours).toHaveBeenCalledWith(
      organizationId,
      branchId,
      weekdays.map((dayOfWeek) => ({
        dayOfWeek,
        status: 'OPEN',
        opensAtMinute: 1320,
        closesAtMinute: 120,
        closesNextDay: true,
      })),
    );
    expect(mapOpeningHoursResponse([...result].reverse())).toEqual(schedule);
  });
  for (const state of ['missing', 'different organization'])
    it(`${state} yields same branch not found`, async () => {
      const { access, repository } = setup();
      vi.mocked(repository.findBranchByOrganizationAndId).mockResolvedValue(null);
      vi.mocked(repository.replaceOpeningHours).mockResolvedValue(null);
      await expect(
        new GetOwnedBranchUseCase(access, repository).execute('verified', organizationId, branchId),
      ).rejects.toThrow(BranchNotFoundError);
      await expect(
        new ReplaceBranchOpeningHoursUseCase(access, repository).execute(
          'verified',
          organizationId,
          branchId,
          { openingHours: schedule },
        ),
      ).rejects.toThrow(BranchNotFoundError);
    });
  it('unexpected failures propagate to sanitized HTTP boundary, not application success', async () => {
    const { access, repository } = setup();
    vi.mocked(repository.replaceOpeningHours).mockRejectedValue(
      new Error('private database details'),
    );
    await expect(
      new ReplaceBranchOpeningHoursUseCase(access, repository).execute(
        'verified',
        organizationId,
        branchId,
        { openingHours: schedule },
      ),
    ).rejects.toThrow();
  });
});
