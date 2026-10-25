# Run Taqseem on a Windows laptop

For a Windows 10 or 11 laptop with nothing installed. One file does everything: it installs
Node.js and pnpm, sets up a PostgreSQL database, builds the website and starts it.

PostgreSQL: if it is already installed on the laptop, that one is used. Otherwise the script
downloads PostgreSQL 17 from the npm registry and keeps it in your Windows user's app data, and
starts it each time you run the script.

## First time

1. On GitHub, open the repository, click **Code → Download ZIP**, and unzip it, for example to
   `C:\Taqseem`. Avoid a OneDrive or Desktop folder that syncs to the cloud.
2. Open that folder and double-click **`setup-windows.bat`**.
3. If Windows shows "Windows protected your PC", click **More info → Run anyway** (the file came
   from a downloaded ZIP). Then click **Yes** when Windows asks for administrator rights. Installing Node.js and PostgreSQL
   needs them.
4. Wait. The first run takes 10–20 minutes on a normal connection: downloads, then a build.
5. When it asks what the website should contain, type:
   - **1** for demo data to try things out (logins `owner@demo.test`, `accountant@demo.test`,
     `staff@demo.test`, password `Demo@12345`), or
   - **2** for your real business: type the business name, the owner's name and email. It shows a
     one-time password; write it down. You choose a new one at first sign-in.
6. The browser opens at **http://localhost:3000**. Sign in.

The website runs **in the background**: you can close the black window and keep using it.

## Every day: `taqseem.bat`

After the first installation, use **`taqseem.bat`** in the same folder. Double-click it for a menu:

| Type                   | What it does                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** Start            | Starts the website in the background (restarts it if it is running). If the code is newer than the last build, or the database needs changes, it does those first. |
| **2** Update           | Gets the latest code from GitHub, then the same as Start.                                                                                                          |
| **3** Stop             | Stops the website. Your data stays.                                                                                                                                |
| **4** Status           | Running or not, the addresses, the code version, where the logs and backups are.                                                                                   |
| **5** Start at sign-in | Turns on (or off) starting the website by itself when you sign in to Windows.                                                                                      |
| **0**                  | Closes the window. The website keeps running.                                                                                                                      |

You can also run it with one word, for example in a shortcut: `taqseem.bat start`,
`taqseem.bat stop`, `taqseem.bat update`, `taqseem.bat status`.

**Database backups:** before any database change, Start and Update back up the whole database to
`.backups` in the project folder (the last 10 are kept). If the backup fails, nothing is changed.
Copy that folder somewhere safe now and then (a USB stick or cloud drive): it is on the same laptop.

## Fresh installation (start again with an empty database)

Tried the demo data and now want to start for real? Double-click `setup-windows.bat` and, at
the first question, type **2** ("Fresh installation"), then type **DELETE** in capitals to
confirm. The script deletes the database and the old settings, keeps the installed programs,
and continues like a first install, asking again: **1** demo data or **2** your business.

Everything in the database is deleted for good: orders, bills, payments, stock, customers.
Only do this before you start entering real business data, or after making a backup. Pressing
Enter (or typing anything other than DELETE) keeps your data.

## Other computers in the office

Start and Status show an address like `http://192.168.1.20:3000`. Open it in a browser on any
computer on the same Wi-Fi or network. The laptop running the website must stay on.

## Updating to a new version

Double-click `taqseem.bat` and type **2** (Update). It:

1. installs Git the first time (the folder from the ZIP is then linked to GitHub; your `.env`,
   `.setup` and data are kept). For a private repository, a GitHub sign-in window opens once;
2. downloads the latest code (if files were changed on this laptop, it lists them and asks before
   replacing them);
3. stops the website, installs new packages, backs up the database and applies database changes,
   rebuilds, and starts the website again.

To use another repository or fork, put its address in `.setup\repo-url.txt`.

**Restoring a backup** (only if an update went wrong): ask for help; the backup is a plain SQL
file that `psql` loads into an empty database.

## Remove everything (after testing)

Double-click **`uninstall-windows.bat`** and type **DELETE**. It:

1. stops the website and turns off "start at Windows sign-in";
2. deletes the database: the app's own PostgreSQL and the whole `%LOCALAPPDATA%\SalesApp` folder
   (data, PostgreSQL itself, the password file), and the `.backups` folder. If an existing PostgreSQL service
   was used, it asks for its `postgres` password and deletes only the `sales_app` database and user;
3. removes the firewall rule;
4. deletes `.env`, `.setup`, `.backups`, `node_modules`, `.next` and `src\generated` from the project folder.

The code stays; delete the folder yourself if you no longer need it. It also offers to uninstall
Node.js, pnpm and Git (type YES); say no if other programs on the laptop use them. Its log is in
`%TEMP%\taqseem-uninstall-log.txt`. Run `setup-windows.bat` to install again from scratch.

## Good to know

- Your data is in `%LOCALAPPDATA%\SalesApp\data` (for example
  `C:\Users\you\AppData\Local\SalesApp\data`), not in the project folder. Deleting the
  project folder does not delete it. Deleting that `SalesApp` folder does. (The folder keeps the
  app's first name, so installations made before the rename keep their data.)
- **Back up regularly:** a laptop can be lost or fail. Before relying on it, set up a daily backup
  or use an online database (see the hosting notes in README.md).
- `%LOCALAPPDATA%\SalesApp\postgres-superuser-password.txt` holds the database administrator
  password the script generated. Keep it private, and include it in backups.
- `.setup\setup-log.txt` and `.setup\deploy-log.txt` log every run of the two files, and
  `.setup\website-log.txt` is the website's own log. Send them if something goes wrong.
- If PostgreSQL was already installed before, the script asks for its `postgres` password once.
- If the window says **SETUP STOPPED**, read the message above it, fix the cause (often no
  internet), and double-click the file again. It continues where it stopped.

## Not yet tested on a real Windows machine

The script was written and reviewed for Windows PowerShell 5.1 but could not be run on Windows
where it was built. If a step fails, the message and `.setup\setup-log.txt` show which one; send
the log and it will be fixed.

## Installer for customers (TaqseemSetup.exe)

For a customer who should not see the code or deal with a database: send them one file.

**Make it** (on your computer, from this folder): `pnpm package:windows`. It builds
`dist\TaqseemSetup-<version>.exe` (about 57 MB). The first run installs Inno Setup for your user
and downloads PostgreSQL and WinSW; later runs reuse them. The setup file holds the compiled
website (no source code, comments or tests), its own Node.js and PostgreSQL, the database
updates, and the setup scripts.

**The customer** double-clicks it, clicks Yes for administrator rights, and follows the wizard:

1. Where to install (default `C:\Program Files\Taqseem`).
2. On a new computer: **Demo data** (to try it) or **My business** (business name, owner's name
   and email).
3. Where Taqseem is already installed: **Update and keep my data** (default), or **Start fresh**
   (type DELETE; everything is deleted).
4. The first sign-in is shown at the end (and saved in `C:\ProgramData\Taqseem\first-login.txt`);
   "Open Taqseem" opens the browser. A Start-menu (and optional desktop) icon opens it later.

Taqseem then runs as two Windows services, **Taqseem database** and **Taqseem website**: they
start with Windows, without any window, and restart by themselves if they stop. The Start menu's
Taqseem folder has **Stop Taqseem** (stops both, and they stay stopped after a restart) and
**Start Taqseem** (starts both again and opens the website); each asks for administrator permission. Other office
computers use the address `http://<this computer>:3000` (a firewall rule is added).

**Updates:** send a newer setup file. It stops the services, replaces the program, backs up the
database (`C:\ProgramData\Taqseem\backups`, last 10 kept) if it has changes, applies them and
starts again. Data is never in the program folder.

**Uninstall:** Windows Settings → Apps → Taqseem. It asks whether to delete the data too (default
no: it stays in `C:\ProgramData\Taqseem` for a later install).

Ports: the database uses 5433 (or the next free port) so it never clashes with another
PostgreSQL; the website uses 3000, or the next free port when 3000 is taken (for example by a
development copy started with `taqseem.bat`). The chosen ports and generated passwords are in
`C:\ProgramData\Taqseem\settings.env`, readable by administrators only. Logs: `C:\ProgramData\Taqseem\logs`.

Without a code-signing certificate Windows shows "Windows protected your PC" at first: More info →
Run anyway. A certificate (about USD 100–300 a year) removes that warning.
