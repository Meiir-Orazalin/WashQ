import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BranchNotFoundError,
  OrganizationNotFoundError,
  type BranchOwnerAccess,
} from '../src/branches/public.js';
import { CreateBranchServiceUseCase } from '../src/branch-services/application/create-branch-service.use-case.js';
import { ListBranchServicesUseCase } from '../src/branch-services/application/list-branch-services.use-case.js';
import { GetBranchServiceUseCase } from '../src/branch-services/application/get-branch-service.use-case.js';
import { UpdateBranchServiceUseCase } from '../src/branch-services/application/update-branch-service.use-case.js';
import {
  ServiceNotFoundError,
  type BranchServiceRepository,
} from '../src/branch-services/application/branch-service.repository.js';
const id = '00000000-0000-4000-8000-000000000001';
const org = '00000000-0000-4000-8000-000000000002';
const branch = '00000000-0000-4000-8000-000000000003';
const input = {
  name: '  Ｗash   Bay ',
  durationMinutes: 30,
  priceMinor: 500000,
  currency: 'KZT' as const,
};
const service = {
  ...input,
  name: 'Wash Bay',
  description: null,
  id,
  isActive: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};
function setup() {
  const access: BranchOwnerAccess = {
    assertCurrentOwner: vi.fn().mockResolvedValue({ branchId: branch }),
  };
  const repository: BranchServiceRepository = {
    create: vi.fn().mockResolvedValue(service),
    listByBranch: vi.fn().mockResolvedValue([service]),
    findByBranchAndId: vi.fn().mockResolvedValue(service),
    updateByBranchAndId: vi.fn().mockResolvedValue(service),
  };
  const calls = [
    () => new CreateBranchServiceUseCase(access, repository).execute(id, org, branch, input),
    () => new ListBranchServicesUseCase(access, repository).execute(id, org, branch),
    () => new GetBranchServiceUseCase(access, repository).execute(id, org, branch, id),
    () =>
      new UpdateBranchServiceUseCase(access, repository).execute(id, org, branch, id, {
        description: null,
        priceMinor: 1,
      }),
  ];
  return { access, repository, calls };
}
describe('branch service use cases and public access boundary', () => {
  it('normalizes creation, returns narrow public projection, lists and retrieves inactive services', async () => {
    const { access, repository, calls } = setup();
    for (const call of calls) await call();
    expect(access.assertCurrentOwner).toHaveBeenCalledTimes(4);
    expect(access.assertCurrentOwner).toHaveBeenCalledWith(id, org, branch);
    expect(repository.create).toHaveBeenCalledWith(branch, {
      ...input,
      name: 'Wash Bay',
      description: null,
    });
    expect(repository.listByBranch).toHaveBeenCalledWith(branch);
    expect(repository.findByBranchAndId).toHaveBeenCalledWith(branch, id);
    expect(repository.updateByBranchAndId).toHaveBeenCalledWith(branch, id, {
      description: null,
      priceMinor: 1,
    });
    expect(vi.mocked(access.assertCurrentOwner).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(repository.create).mock.invocationCallOrder[0] ?? 0,
    );
    expect(Object.keys((await calls[0]?.()) ?? {}).sort()).toEqual([
      'createdAt',
      'currency',
      'description',
      'durationMinutes',
      'id',
      'isActive',
      'name',
      'priceMinor',
      'updatedAt',
    ]);
  });
  it.each([new OrganizationNotFoundError(), new BranchNotFoundError()])(
    'denied parent stops every operation',
    async (failure) => {
      const { access, repository, calls } = setup();
      vi.mocked(access.assertCurrentOwner).mockRejectedValue(failure);
      for (const call of calls) await expect(call()).rejects.toBe(failure);
      for (const operation of Object.values(repository)) expect(operation).not.toHaveBeenCalled();
    },
  );
  it('uses returned validated scope, not a separately trusted transport parent', async () => {
    const { access, repository, calls } = setup();
    vi.mocked(access.assertCurrentOwner).mockResolvedValue({ branchId: id });
    await calls[0]?.();
    expect(vi.mocked(repository.create).mock.calls[0]?.[0]).toBe(id);
  });
  it('partial normalized patch retains omissions and nullable clear', async () => {
    const { access, repository } = setup();
    await new UpdateBranchServiceUseCase(access, repository).execute(id, org, branch, id, {
      name: ' Ｗash   Bay ',
      description: '  ',
      isActive: false,
    });
    expect(repository.updateByBranchAndId).toHaveBeenCalledWith(branch, id, {
      name: 'Wash Bay',
      description: null,
      isActive: false,
    });
  });
  it('missing and foreign scoped detail/update share controlled not found', async () => {
    const { repository, calls } = setup();
    vi.mocked(repository.findByBranchAndId).mockResolvedValue(null);
    vi.mocked(repository.updateByBranchAndId).mockResolvedValue(null);
    for (const index of [2, 3])
      await expect(calls[index]?.()).rejects.toBeInstanceOf(ServiceNotFoundError);
  });
  it('empty list remains empty and unexpected errors are not converted to success/conflict', async () => {
    const { repository, calls } = setup();
    vi.mocked(repository.listByBranch).mockResolvedValue([]);
    expect(await calls[1]?.()).toEqual([]);
    const failure = new Error('private infrastructure failure');
    for (const operation of Object.values(repository))
      vi.mocked(operation).mockRejectedValue(failure);
    for (const call of calls) await expect(call()).rejects.toBe(failure);
  });
  it('source consumes no private parent adapters or membership persistence', () => {
    function inspect(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) inspect(path);
        else
          expect(readFileSync(path, 'utf8')).not.toMatch(
            /(?:branches|organizations)\/(?:application|infrastructure|presentation)|organization_memberships|PrismaBranchRepository|PrismaOrganizationRepository/,
          );
      }
    }
    inspect(new URL('../src/branch-services', import.meta.url).pathname);
  });
});
