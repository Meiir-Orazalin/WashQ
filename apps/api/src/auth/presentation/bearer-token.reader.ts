export function readBearerToken(
  authorizationHeader: string | string[] | undefined,
): string | undefined {
  if (typeof authorizationHeader !== 'string') {
    return undefined;
  }

  const trimmedHeader = authorizationHeader.trim();
  if (trimmedHeader.includes(',')) {
    return undefined;
  }

  const match = /^Bearer +(\S+)$/i.exec(trimmedHeader);
  return match?.[1];
}
