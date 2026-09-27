/**
 * Usage: pnpm --filter @vgb/web create-superadmin <email> [password] [name]
 * Grants platform-admin rights to an existing user, or creates a verified account first.
 */
import { findUserByEmail, grantPlatformAdmin, markEmailVerified } from '@vgb/db';
import { auth } from '../src/lib/auth';
import { db } from '../src/lib/server';

const [email, password, name = 'Administrator'] = process.argv.slice(2);
if (!email) {
  console.error('Usage: create-superadmin <email> [password] [name]');
  process.exit(1);
}

let existing = await findUserByEmail(db(), email);

if (!existing) {
  if (!password || password.length < 10) {
    console.error(
      'User does not exist: provide a password of at least 10 characters to create it.',
    );
    process.exit(1);
  }
  await auth().api.signUpEmail({ body: { email, password, name } });
  existing = await findUserByEmail(db(), email);
  if (!existing) throw new Error('Sign-up did not create the user');
  await markEmailVerified(db(), existing.id);
}

await grantPlatformAdmin(db(), existing.id);
console.log(`Platform admin granted to ${existing.email}`);
process.exit(0);
