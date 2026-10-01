import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CurrentBranchOwnerAccess } from '../src/branches/application/current-branch-owner-access.js';
import { GetOwnedBranchUseCase } from '../src/branches/application/get-owned-branch.use-case.js';
import {
  BranchNotFoundError,
  OrganizationNotFoundError,
  type BranchOwnerAccess,
} from '../src/branches/public.js';
import type { BranchRepository } from '../src/branches/application/branch.repository.js';
import { CreateWashBoxUseCase } from '../src/wash-boxes/application/create-wash-box.use-case.js';
import { ListBranchWashBoxesUseCase } from '../src/wash-boxes/application/list-branch-wash-boxes.use-case.js';
import { GetBranchWashBoxUseCase } from '../src/wash-boxes/application/get-branch-wash-box.use-case.js';
import { SetWashBoxActiveStateUseCase } from '../src/wash-boxes/application/set-wash-box-active-state.use-case.js';
import {
  WashBoxAlreadyExistsError,
  WashBoxNotFoundError,
  type WashBoxRepository,
} from '../src/wash-boxes/application/wash-box.repository.js';
const id = '00000000-0000-4000-8000-000000000001';
const org = '00000000-0000-4000-8000-000000000002';
const branch = '00000000-0000-4000-8000-000000000003';
const box = { id, number: 1, isActive: false, createdAt: new Date(), updatedAt: new Date() };
function setup() {
  const access: BranchOwnerAccess = {
    assertCurrentOwner: vi.fn().mockResolvedValue({ branchId: branch }),
  };
  const repository: WashBoxRepository = {
    create: vi.fn().mockResolvedValue(box),
    listByBranch: vi.fn().mockResolvedValue([box]),
    findByBranchAndId: vi.fn().mockResolvedValue(box),
    setActiveState: vi.fn().mockResolvedValue(box),
  };
  const calls = [
    () => new CreateWashBoxUseCase(access, repository).execute(id, org, branch, { number: 1 }),
    () => new ListBranchWashBoxesUseCase(access, repository).execute(id, org, branch),
    () => new GetBranchWashBoxUseCase(access, repository).execute(id, org, branch, id),
    () =>
      new SetWashBoxActiveStateUseCase(access, repository).execute(id, org, branch, id, {
        isActive: false,
      }),
  ];
  return { access, repository, calls };
}
describe('wash box use cases and public branch boundary', () => {
  it('creates, lists inactive boxes, gets inactive detail and sets explicit state with validated branch scope', async () => {
    const { access, repository, calls } = setup();
    for (const call of calls) await call();
    expect(access.assertCurrentOwner).toHaveBeenCalledTimes(4);
    expect(access.assertCurrentOwner).toHaveBeenCalledWith(id, org, branch);
    expect(repository.create).toHaveBeenCalledWith(branch, 1);
    expect(repository.listByBranch).toHaveBeenCalledWith(branch);
    expect(repository.findByBranchAndId).toHaveBeenCalledWith(branch, id);
    expect(repository.setActiveState).toHaveBeenCalledWith(branch, id, false);
  });
  for (const failure of [new OrganizationNotFoundError(), new BranchNotFoundError()])
    it(`denied ${failure.name} stops every persistence operation`, async () => {
      const { access, repository, calls } = setup();
      vi.mocked(access.assertCurrentOwner).mockRejectedValue(failure);
      for (const call of calls) await expect(call()).rejects.toBe(failure);
      for (const operation of Object.values(repository)) expect(operation).not.toHaveBeenCalled();
    });
  it('checks access before repository, propagates only controlled duplicate and unexpected errors', async () => {
    const { access, repository, calls } = setup();
    await calls[0]?.();
    expect(vi.mocked(access.assertCurrentOwner).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(repository.create).mock.invocationCallOrder[0] ?? 0,
    );
    const failure = new Error('infrastructure failure');
    for (const operation of Object.values(repository))
      vi.mocked(operation).mockRejectedValue(failure);
    for (const call of calls) await expect(call()).rejects.toBe(failure);
    vi.mocked(repository.create).mockRejectedValue(new WashBoxAlreadyExistsError());
    await expect(calls[0]?.()).rejects.toBeInstanceOf(WashBoxAlreadyExistsError);
  });
  it('missing and foreign scoped boxes share not found for detail/state', async () => {
    const { repository, calls } = setup();
    vi.mocked(repository.findByBranchAndId).mockResolvedValue(null);
    vi.mocked(repository.setActiveState).mockResolvedValue(null);
    await expect(calls[2]?.()).rejects.toBeInstanceOf(WashBoxNotFoundError);
    await expect(calls[3]?.()).rejects.toBeInstanceOf(WashBoxNotFoundError);
  });
  it('supports empty ordered repository listing and rejects invalid input before persistence', async () => {
    const { access, repository } = setup();
    vi.mocked(repository.listByBranch).mockResolvedValue([]);
    expect(
      await new ListBranchWashBoxesUseCase(access, repository).execute(id, org, branch),
    ).toEqual([]);
    await expect(
      new CreateWashBoxUseCase(access, repository).execute(id, org, branch, { number: 0 }),
    ).rejects.toThrow();
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('branch access reuses organization assertion/scoped lookup and exposes only frozen branch ID', async () => {
    const orgAccess = { assertCurrentOwner: vi.fn().mockResolvedValue(undefined) };
    const branches: BranchRepository = {
      createBranch: vi.fn(),
      listBranchesByOrganization: vi.fn(),
      replaceOpeningHours: vi.fn(),
      findBranchByOrganizationAndId: vi
        .fn()
        .mockResolvedValue({ id: branch, openingHours: [{ internal: true }] }),
    };
    const access = new CurrentBranchOwnerAccess(new GetOwnedBranchUseCase(orgAccess, branches));
    const scope = await access.assertCurrentOwner(id, org, branch);
    expect(scope).toEqual({ branchId: branch });
    expect(Object.isFrozen(scope)).toBe(true);
    expect(branches.findBranchByOrganizationAndId).toHaveBeenCalledWith(org, branch);
    vi.mocked(branches.findBranchByOrganizationAndId).mockResolvedValue(null);
    await expect(access.assertCurrentOwner(id, org, branch)).rejects.toBeInstanceOf(
      BranchNotFoundError,
    );
    orgAccess.assertCurrentOwner.mockRejectedValue(new OrganizationNotFoundError());
    await expect(access.assertCurrentOwner(id, org, branch)).rejects.toBeInstanceOf(
      OrganizationNotFoundError,
    );
  });
  it('wash box source imports no private parent persistence or membership models', () => {
    function inspect(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) inspect(path);
        else {
          const source = readFileSync(path, 'utf8');
          expect(source).not.toMatch(
            /(?:branches|organizations)\/(?:application|infrastructure|presentation)|organization_memberships|PrismaBranchRepository|PrismaOrganizationRepository/,
          );
        }
      }
    }
    inspect(new URL('../src/wash-boxes', import.meta.url).pathname);
  });
});
