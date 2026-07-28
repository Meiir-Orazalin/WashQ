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

export interface UserAuthenticationRecord {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  passwordHash: string;
}

export interface PublicUser {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
}

export interface UserRepository {
  create(user: CreateUser): Promise<RegisteredUser>;
  findAuthenticationByEmail(email: string): Promise<UserAuthenticationRecord | null>;
  findPublicById(id: string): Promise<PublicUser | null>;
}

export class DuplicateUserEmailError extends Error {
  constructor() {
    super('A user with this email already exists');
    this.name = 'DuplicateUserEmailError';
  }
}
