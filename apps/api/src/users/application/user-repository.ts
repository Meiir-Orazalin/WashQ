export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface CreateUser {
  firstName: string;
  lastName: string | null;
  email: string;
  passwordHash: string;
}

export interface RegisteredUser {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  createdAt: Date;
}

export interface UserRepository {
  create(user: CreateUser): Promise<RegisteredUser>;
}

export class DuplicateUserEmailError extends Error {
  constructor() {
    super('A user with this email already exists');
    this.name = 'DuplicateUserEmailError';
  }
}
