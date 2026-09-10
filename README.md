# Sawmill ERP — Cloud Edition

Same app as before — sales/purchase invoicing with GST, e-way bill printing,
stock/lots, ledgers, khata, manager accounts, Excel import — but now:

- **Data lives in MongoDB Atlas**, not a file on one PC. Log in from any
  device (office PC, laptop, phone) and see the same data.
- **Login screen.** The first person to sign in creates the admin account;
  after that, an admin can create additional logins from Settings (e.g. for
  a manager).
- **Installable on your phone** as a Progressive Web App (PWA) — no app
  store needed.
- **New features:** low-stock alerts, a GST rate-wise summary report, a
  stock valuation report, dashboard charts, a Trash/Recycle Bin for
  accidental deletes, and automatic dated backups in the cloud.

---

## 1. Set up MongoDB Atlas (free tier is enough)

1. Go to https://www.mongodb.com/cloud/atlas/register and create a free
   account (or log into your existing one).
2. Create a **free cluster** (the "M0" tier — no cost).
3. Under **Database Access**, create a database user with a username and
   password (write these down — you'll need them in a moment).
4. Under **Network Access**, add an IP entry `0.0.0.0/0` ("Allow access
   from anywhere") so Render can connect. (You can restrict this later.)
5. Go to your cluster → **Connect** → **Drivers** → copy the connection
   string. It looks like:
   ```
   mongodb+srv://USERNAME:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
6. Replace `<password>` with your real database user password. **This full
   string is your `MONGODB_URI`.** Keep it somewhere safe — it's effectively
   the password to your whole business database.

## 2. Deploy to Render

You said your Render account is already connected to GitHub, so:

1. Push this whole `sawmill-erp` folder to a **new GitHub repository**
   (private is recommended, since this code will reference your business).
2. In Render: **New +** → **Web Service** → pick that repository.
3. Render should auto-detect the settings from `render.yaml` in this
   folder (build command `npm install`, start command `npm start`). If it
   asks manually: Runtime = Node, Build Command = `npm install`, Start
   Command = `npm start`.
4. Under **Environment**, add:
   - `MONGODB_URI` = the connection string from Step 1
   - `JWT_SECRET` = Render will auto-generate this if you used the
     blueprint; otherwise set it to any long random string yourself.
5. Click **Create Web Service**. First deploy takes a few minutes.
6. Once it's live, open the `.onrender.com` URL Render gives you — that's
   your app, reachable from anywhere.

**Note on Render's free tier:** free web services "sleep" after periods of
inactivity and take ~30–60 seconds to wake up on the next visit. This is a
Render limitation, not something in the app — an upgrade to a paid Render
plan removes it if that delay bothers you.

## 3. First login

Open your Render URL. Since no account exists yet, you'll see **"Create
your account"** — set a username and password for yourself (this becomes
the admin account). From then on, everyone sees a normal login screen.

To add a login for someone else (e.g. a manager), log in as admin and go to
**Company & Settings → Your Account → Add a team member login**.

Right now everyone who logs in shares the same business data (like the
original app) — this isn't a multi-tenant system with separate businesses
per login, it's shared books with per-person logins, which matches how a
single sawmill business normally works.

## 4. Install it on your phone (PWA)

- **Android (Chrome):** open the site → tap the **⋮** menu → **"Add to Home
  screen" / "Install app"**.
- **iPhone (Safari):** open the site → tap the **Share** icon → **"Add to
  Home Screen"**.

It'll appear as a normal app icon and open full-screen, no browser bars.

## 5. Testing locally before you deploy (optional)

```
cp .env.example .env
# edit .env and paste in your MONGODB_URI and a JWT_SECRET
npm install
npm start
```
Then open http://localhost:4173.

## What changed under the hood

- `server.js` — rewritten to use the MongoDB Node driver instead of
  reading/writing a local JSON file. Adds `/api/auth/*` routes for login,
  and every `/api/db` call now requires a valid login token.
- Every save automatically snapshots the *previous* version into a
  `backups` collection (last 10 kept) — restorable from Settings.
- `public/manifest.json`, `public/service-worker.js`, `public/icons/` —
  make the app installable as a PWA.
- `render.yaml` — deployment blueprint for Render.

## Limits to know about

- This is still a single shared "books" per deployment (one business), with
  multiple user *logins* — it is not a multi-company SaaS with billing.
  (The app's existing multi-company switcher inside Settings still works
  the same as before, within that one shared login.)
- Free-tier MongoDB Atlas (M0) has a 512MB storage cap — plenty for years of
  invoices/text data for a business this size, but keep it in mind long-term.
- The GST Summary report is a rate-wise total for your own filing
  reference — it is **not** an official GSTR-1/3B export file.
