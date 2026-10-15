import 'dotenv/config';
import { z } from 'zod';
import { configuredRegistrationMode } from './identity/registration-policy.ts';

/** One runtime contract shared by native services and containers. */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1).optional(),
  PGHOST: z.string().min(1).optional(),
  PGUSER: z.string().min(1).optional(),
  PGPASSWORD: z.string().optional(),
  PGDATABASE: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(32),
  REGISTRATION_MODE:z.enum(['open','bootstrap','closed']).optional(),
  BOOTSTRAP_TOKEN:z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
}).superRefine((v, ctx) => {
  const issue = (path: string, message: string) =>
    ctx.addIssue({code: z.ZodIssueCode.custom, path: [path], message});
  if (!v.DATABASE_URL && !(v.PGHOST && v.PGUSER && v.PGDATABASE))
    issue('DATABASE_URL', 'Set DATABASE_URL or PGHOST, PGUSER and PGDATABASE');
  if (v.NODE_ENV === 'production') {
    if (/replace|example|changeme/i.test(v.SESSION_SECRET))
      issue('SESSION_SECRET', 'Replace the example session secret before production');
    const origin = new URL(v.WEB_ORIGIN);
    if (origin.protocol !== 'https:' &&
        !(origin.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))
      issue('WEB_ORIGIN', 'Production public origins must use HTTPS (local loopback excepted)');
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error('Invalid ChatPM configuration: ' +
    parsed.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; '));
}
export const serverConfig = {...parsed.data,
  REGISTRATION_MODE:configuredRegistrationMode(parsed.data.NODE_ENV,parsed.data.REGISTRATION_MODE),
};
