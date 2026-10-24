# Run Sales App on a Windows laptop

For a Windows 10 or 11 laptop with nothing installed. One file does everything: it installs
Node.js and pnpm, sets up a PostgreSQL database, builds the website and starts it.

PostgreSQL: if it is already installed on the laptop, that one is used. Otherwise the script
downloads PostgreSQL 17 from the npm registry and keeps it in your Windows user's app data, and
starts it each time you run the script.

## First time

1. On GitHub, open the repository, click **Code → Download ZIP**, and unzip it, for example to
   `C:\SalesApp`. Avoid a OneDrive or Desktop folder that syncs to the cloud.
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

Keep the black window open while you use the website. Closing it stops the website.

## Every day

Double-click `setup-windows.bat` again and press **Enter** at the first question (1 = start the
website and keep all data). It checks that everything is installed, updates the database if
needed, and starts the website. It is quick after the first time.

## Fresh installation (start again with an empty database)

Tried the demo data and now want to start for real? Double-click `setup-windows.bat` and, at
the first question, type **2** ("Fresh installation"), then type **DELETE** in capitals to
confirm. The script deletes the database and the old settings, keeps the installed programs,
and continues like a first install, asking again: **1** demo data or **2** your business.

Everything in the database is deleted for good: orders, bills, payments, stock, customers.
Only do this before you start entering real business data, or after making a backup. Pressing
Enter (or typing anything other than DELETE) keeps your data.

## Other computers in the office

The window shows an address like `http://192.168.1.20:3000`. Open it in a browser on any
computer on the same Wi-Fi or network. The laptop running the window must stay on.

## Updating to a new version

1. Close the black window.
2. Download the new ZIP and unzip it **over the same folder** (replace files). Keep the `.env`
   file and the `.setup` folder: they hold the database password and secret key.
3. Double-click `setup-windows.bat`. It installs new packages, updates the database and rebuilds.

## Good to know

- Your data is in `%LOCALAPPDATA%\SalesApp\data` (for example
  `C:\Users\you\AppData\Local\SalesApp\data`), not in the project folder. Deleting the
  project folder does not delete it. Deleting that `SalesApp` folder does.
- **Back up regularly:** a laptop can be lost or fail. Before relying on it, set up a daily backup
  or use an online database (see the hosting notes in README.md).
- `%LOCALAPPDATA%\SalesApp\postgres-superuser-password.txt` holds the database administrator
  password the script generated. Keep it private, and include it in backups.
- `.setup\setup-log.txt` has a log of every run. Send it if something goes wrong.
- If PostgreSQL was already installed before, the script asks for its `postgres` password once.
- If the window says **SETUP STOPPED**, read the message above it, fix the cause (often no
  internet), and double-click the file again. It continues where it stopped.

## Not yet tested on a real Windows machine

The script was written and reviewed for Windows PowerShell 5.1 but could not be run on Windows
where it was built. If a step fails, the message and `.setup\setup-log.txt` show which one; send
the log and it will be fixed.
