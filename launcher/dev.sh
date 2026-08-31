#!/usr/bin/env bash
#
# Start Beyond's dev server. Called from Windows by Beyond.cmd, and perfectly
# fine to run by hand: bash launcher/dev.sh
#
set -e

# nvm installs itself into ~/.bashrc, and a script shell does not read that
# file — so a plain `wsl bash script.sh` finds no node at all. Loading it here
# explicitly is the difference between this working and "npm: command not
# found" from a launcher with nowhere to show the error.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
fi

# Run from the project root whatever directory we were invoked from, so the
# launcher does not care where the shortcut was clicked.
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "First run here — installing dependencies. This takes a minute or two."
  npm install
fi

echo
echo "  Beyond is starting on http://localhost:5173"
echo "  Close this window when you are done to stop it."
echo
exec npm run dev
