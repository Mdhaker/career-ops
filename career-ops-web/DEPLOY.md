# Career-Ops Web — Deployment Guide

## Prerequisites

- GitHub account (repo already exists or you'll push to a new one)
- [Supabase](https://supabase.com) account (free tier)
- [Render](https://render.com) account (free tier)

---

## Step 1 — Create Supabase Project

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. Choose a name (e.g. `career-ops`), pick the closest region, set a DB password
3. Wait ~2 minutes for the project to provision

### Run the schema

4. Go to **SQL Editor** (left sidebar) → **New query**
5. Paste the entire contents of `career-ops-web/supabase/schema.sql`
6. Click **Run** — you should see `Success. No rows returned` 

### Get your credentials

7. Go to **Project Settings** → **API**
8. Copy:
   - **Project URL** → this is `VITE_SUPABASE_URL`
   - **anon / public key** → this is `VITE_SUPABASE_ANON_KEY`

### Configure Auth

9. Go to **Authentication** → **Providers** → ensure **Email** is enabled
10. Go to **Authentication** → **URL Configuration**:
    - **Site URL**: set to your Render URL (e.g. `https://career-ops-web.onrender.com`) — you can update this after step 3
    - **Redirect URLs**: add `https://career-ops-web.onrender.com/**`

---

## Step 2 — Create Render Static Site

1. Go to [https://dashboard.render.com](https://dashboard.render.com) → **New +** → **Static Site**
2. Connect your GitHub repository
3. Configure:
   - **Name**: `career-ops-web`
   - **Root Directory**: `career-ops-web`
   - **Build Command**: `npm ci && npm run build`
   - **Publish Directory**: `dist`
4. Add environment variables (click **Advanced** → **Add Environment Variable**):
   - `VITE_SUPABASE_URL` → paste the Project URL from Step 1
   - `VITE_SUPABASE_ANON_KEY` → paste the anon key from Step 1
5. Click **Create Static Site**
6. Wait for the first deploy to complete — copy your `.onrender.com` URL
7. Go back to Supabase → **Authentication** → **URL Configuration** → update Site URL and Redirect URLs with your Render URL

---

## Step 3 — Configure GitHub Actions (for auto-deploy on push)

### Add GitHub Secrets

Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret name | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `RENDER_SERVICE_ID` | Your Render service ID (see below) |
| `RENDER_API_KEY` | Your Render API key (see below) |

### Get Render credentials

- **Service ID**: Go to your Render service → the URL contains it: `https://dashboard.render.com/static/srv-XXXXXXXXXX` — copy `srv-XXXXXXXXXX`
- **API Key**: Go to [https://dashboard.render.com/u/settings#api-keys](https://dashboard.render.com/u/settings#api-keys) → create a new API key

### How CI/CD works

- Every push to `main` that touches anything under `career-ops-web/` triggers the workflow
- GitHub Actions builds the app with your secrets injected as env vars
- On success, it calls the Render deploy API to trigger a fresh deploy
- The workflow file is at `.github/workflows/deploy-web.yml`

---

## Step 4 — Local development

```bash
# Inside career-ops-web/
cp .env.example .env
# Edit .env with your Supabase credentials

npm install
npm run dev
# Open http://localhost:5173
```

---

## Environment variables reference

| Variable | Where to get it | Required |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | ✅ |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public | ✅ |

> **Security note**: The `anon` key is safe to expose in the frontend — it's designed for that. Row Level Security (RLS) policies in the schema ensure each user can only access their own data. Never use the `service_role` key in the frontend.

---

## Connecting the CLI to the same data

Once the web app is deployed, you can sync the pipeline tracker back to the CLI by:

1. Exporting applications from the web app (future feature) or
2. Manually copying your `data/applications.md` entries to the web tracker

The web app and CLI currently operate independently — the web app stores all data in Supabase, while the CLI uses local files. They share the same data model and status vocabulary (`templates/states.yml`).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| White screen after deploy | Check browser console for `Missing Supabase environment variables` — env vars not set in Render |
| Auth redirect loop | Update Supabase Site URL and Redirect URLs to match your exact Render URL |
| "relation does not exist" error | Re-run the schema SQL in Supabase SQL Editor |
| Build fails in GitHub Actions | Check that all 4 secrets are set correctly in repo Settings |
