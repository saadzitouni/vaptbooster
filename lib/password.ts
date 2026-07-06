// Password hashing helpers. bcryptjs is pure-JS (no native build),
// so it runs the same on Windows dev and Linux containers.
import bcrypt from "bcryptjs";

const ROUNDS = 10;

// A precomputed hash used to run a constant-time comparison when an account
// doesn't exist — so a missing user and a wrong password take the same time
// (prevents user enumeration via login timing).
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync("timing-safe-dummy", ROUNDS);

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
