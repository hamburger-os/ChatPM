import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { pool } from './db.ts';
import { SignJWT, jwtVerify } from 'jose';

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return new TextEncoder().encode(value);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
export async function createSession(userId: string) {
  const id = randomUUID();
  await pool.query(`INSERT INTO sessions(id,user_id,expires_at)
    VALUES($1,$2,NOW()+INTERVAL '7 days')`, [id,userId]);
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId).setJti(id).setIssuedAt().setExpirationTime('7d').sign(secret());
}
export async function readSession(token: string): Promise<string | null> {
  try {
    const result = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    const userId=result.payload.sub, id=result.payload.jti;
    if(typeof userId!=='string'||typeof id!=='string') return null;
    const {rows}=await pool.query(`SELECT user_id FROM sessions
      WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>NOW()`,[id,userId]);
    return rows[0]?.user_id??null;
  } catch {
    return null;
  }
}
export async function revokeSession(token: string): Promise<void> {
  try {
    const result=await jwtVerify(token,secret(),{algorithms:['HS256']});
    if(typeof result.payload.jti==='string' && typeof result.payload.sub==='string')
      await pool.query('UPDATE sessions SET revoked_at=NOW() WHERE id=$1 AND user_id=$2',
        [result.payload.jti,result.payload.sub]);
  } catch {
    // An invalid or already expired token does not prevent cookie clearing.
  }
}
