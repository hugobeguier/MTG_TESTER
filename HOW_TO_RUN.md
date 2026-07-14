# How To Run MTG-AI

These commands assume Windows PowerShell and that you are in the project folder:

```powershell
cd D:\MTG-AI
```

## 1. Install Node dependencies

Run this once after cloning the project, or again after `package.json` changes.

```powershell
npm.cmd install
```

## 2. Import card data

Run this once before using deck validation/building. Re-run it when you want to refresh the local card catalog.

```powershell
npm.cmd run cards:import
```

## 3. Install and start Ollama

Install Ollama from:

```text
https://ollama.com/download
```

Then start the Ollama server. Keep this terminal open.

```powershell
ollama serve
```

If you see this error, Ollama is already running and you can continue:

```text
listen tcp 127.0.0.1:11434: bind: Only one usage of each socket address...
```

Check that Ollama is available:

```powershell
ollama list
```

## 4. Pull the base LLM

Run this once:

```powershell
ollama pull llama3.2
```

## 5. Create the MTG agent models

Run these from `D:\MTG-AI`:

```powershell
ollama create mtg-veyra -f .\ollama\veyra.Modelfile
ollama create mtg-malik -f .\ollama\malik.Modelfile
ollama create mtg-sable -f .\ollama\sable.Modelfile
```

Confirm they exist:

```powershell
ollama list
```

You should see:

```text
llama3.2:latest
mtg-veyra:latest
mtg-malik:latest
mtg-sable:latest
```

## 6. Run the app

In a new PowerShell terminal:

```powershell
cd D:\MTG-AI
npm.cmd run dev -- --hostname 127.0.0.1 --port 3001
```

Open:

```text
http://127.0.0.1:3001
```

Port `3000` may also work, but on this machine it has returned `EACCES: permission denied`, so `3001` is the safer default.

## Optional environment variables

The app defaults to Ollama at `http://localhost:11434` and uses agent-specific models for deck building. You only need these if you want to override the defaults.

```powershell
$env:OLLAMA_BASE_URL = "http://localhost:11434"
$env:OLLAMA_MODEL = "llama3.2"
$env:OLLAMA_RULES_MODEL = "llama3.2"
npm.cmd run dev -- --hostname 127.0.0.1 --port 3001
```

## Useful checks

Run tests:

```powershell
npm.cmd test
```

Run a production build:

```powershell
npm.cmd run build
```

Check whether Ollama is listening:

```powershell
Get-NetTCPConnection -LocalPort 11434 -ErrorAction SilentlyContinue
```

Check whether the app is listening:

```powershell
Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
```

## Normal startup order

Use this order when starting from scratch.

First terminal:

```powershell
cd D:\MTG-AI
npm.cmd install
npm.cmd run cards:import
ollama serve
```

Keep that terminal open. Then use a second terminal:

```powershell
cd D:\MTG-AI
ollama pull llama3.2
ollama create mtg-veyra -f .\ollama\veyra.Modelfile
ollama create mtg-malik -f .\ollama\malik.Modelfile
ollama create mtg-sable -f .\ollama\sable.Modelfile
```

Then start the web app from the second terminal:

```powershell
cd D:\MTG-AI
npm.cmd run dev -- --hostname 127.0.0.1 --port 3001
```

# TO RESTART ALL FOLLOW THIS:

To fully restart it cleanly:

  1. Stop the Next app terminal:

  Ctrl + C

  2. If rendering looks stale or broken, clear Next’s cache:

  cd D:\MTG-AI
  Remove-Item -LiteralPath .next -Recurse -Force

  3. Start the app again:

  npm.cmd run dev -- --hostname 127.0.0.1 --port 3001

  4. Open:

  http://127.0.0.1:3001

  For Ollama: if you already have Ollama running, do not start another ollama serve. That “bind” error means it is
  already running. You can check with:

  ollama list

  About cards losing their design: that usually means the browser or Next dev server is holding stale rendered state/
  assets. After restarting, do a hard refresh in the browser:

  Ctrl + Shift + R

  If it still happens after that, it is likely not a restart issue anymore. Then it is probably a card image/render
  fallback bug, especially for cards on the battlefield.