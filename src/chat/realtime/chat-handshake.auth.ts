import { JwtService } from '@nestjs/jwt';
import { JwtPayloadType } from '../../auth/strategies/types/jwt-payload.type';

/**
 * Pulls the JWT from a Socket.IO handshake. Callers (gateway and tests)
 * pass `handshake.auth` and `handshake.headers`, and we look in:
 *   1. handshake.auth.token       (preferred)
 *   2. Authorization: Bearer <jwt>
 */
export function extractTokenFromHandshake(opts: {
  auth?: { token?: unknown };
  headers?: Record<string, unknown>;
}): string | null {
  const fromAuth = opts.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) {
    return fromAuth;
  }
  const headerVal =
    opts.headers?.authorization ?? opts.headers?.Authorization ?? null;
  if (
    typeof headerVal === 'string' &&
    headerVal.toLowerCase().startsWith('bearer ')
  ) {
    const tok = headerVal.slice(7).trim();
    return tok.length > 0 ? tok : null;
  }
  return null;
}

/**
 * Validates a JWT against the same secret the JwtStrategy uses.
 * Returns the decoded payload (id, role, sessionId, iat, exp) or null
 * for any failure (missing token, bad signature, expired).
 *
 * Pure helper — no side effects, easy to unit-test.
 */
export async function validateHandshakeToken(
  jwt: JwtService,
  secret: string,
  token: string | null,
): Promise<JwtPayloadType | null> {
  if (!token) return null;
  try {
    const payload = await jwt.verifyAsync<JwtPayloadType>(token, { secret });
    if (!payload || typeof payload.id !== 'number') return null;
    return payload;
  } catch {
    return null;
  }
}
