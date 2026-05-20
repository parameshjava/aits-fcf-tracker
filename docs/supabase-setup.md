# Supabase setup

## 1. Create a Supabase project

1. Go to https://supabase.com and sign in (or create an account)
2. Click **New project**
3. Fill in:
   - **Name**: `aits-fcf-tracker` (or any name)
   - **Database Password**: create a strong password and **save it** — you'll need it later
   - **Region**: choose the one closest to you (e.g., Singapore, Mumbai, US East)
   - **Pricing Plan**: Free tier is sufficient to start
4. Click **Create new project** (takes about 1–2 minutes)

## 2. Get API credentials

1. In your project dashboard, open **Project Settings** (gear icon) > **API Keys**
2. Under **Project URL**, copy the value — this is `NEXT_PUBLIC_SUPABASE_URL`
3. Under **Publishable key** (formerly called *anon public* — same value, new label in the modern dashboard), click **Copy** — this is `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## 3. Configure local environment

In the project root, create a file called `.env.local`:

```bash
cp .env.example .env.local
```

Then edit `.env.local` and paste the two values from the previous step:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

## 4. Run the database schema

1. In your Supabase dashboard, go to **SQL Editor**
2. Click **New query**
3. Open `docs/supabase-schema.sql` from this project and copy the entire contents
4. Paste into the SQL Editor and click **Run** (or press `Cmd+Enter`)
5. You should see success messages for each table and policy created

## 5. Configure Auth settings

In the Supabase dashboard, open **Authentication** from the left sidebar. The Authentication area is now split into **Manage**, **Notifications**, and **Configuration** groups.

1. Under **Configuration**, click **URL Configuration**
2. Set **Site URL** to your app URL:
   - For local development: `http://localhost:3000`
3. Under **Redirect URLs**, click **Add URL** and add each of these:
   - `http://localhost:3000/auth/callback`
   - `https://your-app.vercel.app/auth/callback` (replace with your actual Vercel URL)
4. Click **Save changes**

> The PKCE flow is the default for the JS client used by this app — no separate toggle is required.

## 6. Enable Google sign-in (with email allowlist)

This app is **Google-only** — there is no email/password form and no signup page. Access is restricted to a hand-maintained allowlist of Google accounts. To make it work, you must (a) disable email/password signups, (b) wire up Google OAuth in Supabase, (c) seed the allowlist, and (d) register the Before-User-Created hook.

### a. Disable the email/password provider

1. Go to **Authentication** > **Configuration** > **Sign In / Providers**
2. At the top, in the **User Signups** section, keep **Allow new users to sign up** ON — the hook still gates who can actually sign in
3. In the providers list, open **Email** and turn **Enable Email provider** OFF. Save.

### b. Create Google OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** > **Credentials**
2. Click **Create credentials** > **OAuth client ID** > **Web application**
3. Under **Authorized redirect URIs**, add the Supabase callback URL shown in the next step (looks like `https://<project-ref>.supabase.co/auth/v1/callback`)
4. Copy the generated **Client ID** and **Client Secret**

### c. Enable Google in Supabase

1. In the dashboard, go to **Authentication** > **Configuration** > **Sign In / Providers**
2. Click **Google** and toggle **Enable Sign In with Google**
3. Paste the **Client ID** and **Client Secret** from Google Cloud
4. Copy the **Callback URL** shown here back into your Google OAuth client (step b.3) if you didn't already
5. Click **Save**

### d. Seed the email allowlist

The schema (§4) creates a `public.allowed_emails` table and an `enforce_email_allowlist` function. The `role` column decides what `profiles.role` gets set to on first sign-in:

```sql
insert into public.allowed_emails (email, role, note) values
  ('alice@gmail.com', 'admin', 'founder'),
  ('bob@gmail.com',   'user',  'treasurer')
on conflict (email) do update
  set role = excluded.role,
      note = excluded.note;
```

> Emails are matched case-insensitively. Add yourself with `role = 'admin'` before testing, or you'll lock yourself out of the Admin panel.

### e. Register the Before-User-Created auth hook

1. Go to **Authentication** > **Configuration** > **Auth Hooks (BETA)**
2. Click **Add hook** (or **Create a hook**) and choose **Before User Created**
3. **Hook type**: `Postgres`
4. **Schema**: `public`
5. **Function**: `enforce_email_allowlist`
6. Click **Create hook** and ensure the hook is **Enabled**

From now on, any Google sign-in whose email is not in `allowed_emails` is rejected before a row in `auth.users` is created. The login page surfaces the rejection message from the hook.

### f. Managing the allowlist later

Add, promote, or remove emails any time via SQL Editor:

```sql
-- Add a regular user
insert into public.allowed_emails (email, role, note)
values ('carol@gmail.com', 'user', 'auditor')
on conflict (email) do update
  set role = excluded.role,
      note = excluded.note;

-- Promote an existing user to admin (a trigger keeps profiles.role in sync)
update public.allowed_emails set role = 'admin' where email = 'carol@gmail.com';

-- Remove (existing user accounts are NOT deleted automatically; remove them from
-- Authentication > Users if you also want to revoke their session)
delete from public.allowed_emails where email = 'carol@gmail.com';
```

## 7. First sign-in and roles

Roles are now driven by `public.allowed_emails.role`, so admins are provisioned automatically the first time they sign in:

1. Start the app: `npm run dev`
2. Go to `http://localhost:3000/auth/login` and click **Continue with Google**
3. Sign in with an email that has `role = 'admin'` in `allowed_emails` (e.g. `paramesh.java5@gmail.com` from the seed in §4) — you'll land on `/dashboard` and the **Admin panel** button will be visible
4. To promote/demote later, just update the allowlist; a trigger keeps `profiles.role` in sync:
   ```sql
   update public.allowed_emails set role = 'admin' where email = 'someone@gmail.com';
   ```

## 8. Seed historical data (optional)

If you have the Excel file (`FCF Latest one upto 6_07_2020..xlsx`) in the project root:

```bash
python3 scripts/extract_data.py
```

This generates `src/data/seed.json` which the Reports page reads to display charts and historical data. No database import needed — the charts use this JSON file directly.

## Troubleshooting

| Problem                                        | Fix                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `Auth session missing`                         | Clear cookies and sign in again                                  |
| `relation "profiles" does not exist`           | Run the SQL schema again                                         |
| `Failed to fetch` on login                     | Check `NEXT_PUBLIC_SUPABASE_URL` is correct                      |
| Signup says "check email" but no email arrives | Check Authentication > Providers > Email > Confirm email setting |
