# Vercel deployment setup

This guide covers two approaches:
- **A: Deploy via GitHub Actions** (recommended for CI/CD)
- **B: Deploy directly via Vercel dashboard** (simpler, manual)

## Prerequisites

- A GitHub repository with this project pushed to it
- A Vercel account (sign up at https://vercel.com using GitHub for easiest setup)
- Supabase project set up and running (see `docs/supabase-setup.md`)

## Approach A: GitHub Actions (CI/CD)

### Step 1: Create Vercel project

Install the Vercel CLI and link the project:

```bash
npm i -g vercel
vercel login
vercel link
```

This creates a `.vercel/project.json` file containing `orgId` and `projectId`.

### Step 2: Generate Vercel token

1. Go to https://vercel.com/account/tokens
2. Click **Create** token
3. Give it a name (e.g., `fcf-tracker-github-actions`)
4. Copy the token value immediately — you won't see it again

### Step 3: Add GitHub repository secrets

In your GitHub repo, go to **Settings** > **Secrets and variables** > **Actions** > **New repository secret**.

Add these secrets:

| Secret                                 | Value                      | Where to find it                                               |
| -------------------------------------- | -------------------------- | -------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | `https://xxxx.supabase.co` | Supabase Project Settings > API Keys                           |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...`       | Supabase Project Settings > API Keys (formerly the "anon" key) |
| `VERCEL_TOKEN`                         | Token from Step 2          | Vercel Account > Tokens                                        |
| `VERCEL_ORG_ID`                        | `team_xxxx` or `user_xxxx` | `.vercel/project.json` > `orgId`                               |
| `VERCEL_PROJECT_ID`                    | `prj_xxxx`                 | `.vercel/project.json` > `projectId`                           |

### Step 4: Push to main

Once secrets are set, push to the `main` branch:

```bash
git push origin main
```

The workflow in `.github/workflows/deploy.yml` will:
1. Install dependencies
2. Run lint
3. Run TypeScript check
4. Build the project
5. Deploy to Vercel

Check progress in GitHub: **Actions** tab > **Deploy to Vercel** workflow.

## Approach B: Vercel dashboard (manual)

### Step 1: Import repository

1. Log in to https://vercel.com
2. Click **Add New** > **Project**
3. Connect your GitHub account and select the repository
4. Click **Import**

### Step 2: Configure environment variables

Under **Environment Variables**, add:

| Name                                   | Value                              |
| -------------------------------------- | ---------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | `https://your-project.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...`               |

### Step 3: Deploy

Click **Deploy**. Vercel will build and deploy automatically.

### Step 4: Set up automatic deployments

After the first deploy, Vercel automatically deploys every push to the connected branch (usually `main`). No GitHub Actions needed.

## Post-deployment: Update Supabase auth settings

After deploying, add your Vercel domain to Supabase:

1. Go to Supabase > **Authentication** > **Configuration** > **URL Configuration**
2. Under **Site URL**, enter `https://your-app.vercel.app`
3. Under **Redirect URLs**, add `https://your-app.vercel.app/auth/callback`
4. Click **Save changes**

## Environment variables summary

All environments (local, preview, production) need these:

```
NEXT_PUBLIC_SUPABASE_URL=<supabase-project-url>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<supabase-publishable-key>
```

No other secrets or config are needed.

## Troubleshooting Vercel deployment

| Problem                                             | Fix                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| Build fails with `NEXT_PUBLIC_SUPABASE_URL not set` | Add the env vars in Vercel Project Settings > Environment Variables               |
| Login redirects to `localhost` after deploy         | Update Supabase Auth settings with your Vercel URL                                |
| 404 on page refresh                                 | Vercel handles this automatically with Next.js — no `vercel.json` redirect needed |
| `@supabase/ssr` import errors                       | Run `npm install` locally and commit updated `package-lock.json`                  |

## Custom domain (optional)

1. In Vercel dashboard, go to your project > **Settings** > **Domains**
2. Enter your domain and follow the DNS configuration instructions
3. Update Supabase Auth settings with the custom domain URL
