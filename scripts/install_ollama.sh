#!/usr/bin/env bash

# install_ollama.sh – runs on first app launch (or post‑install) to ensure Ollama is present.
# It attempts to install Homebrew if missing, then installs Ollama.

set -e

# Helper to log messages
log() {
  echo "[install_ollama] $1"
}

# Check if Ollama already exists
if command -v ollama >/dev/null 2>&1; then
  log "Ollama already installed."
  exit 0
fi

# Ensure Homebrew is present (macOS only)
if ! command -v brew >/dev/null 2>&1; then
  log "Homebrew not found – installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add Homebrew to PATH for the current session
  eval "$(/opt/homebrew/bin/brew shellenv)" || eval "$(/usr/local/bin/brew shellenv)"
fi

log "Installing Ollama via Homebrew..."
brew install ollama

log "Ollama installation complete."

# Optionally start the server to verify it works (background)
if command -v ollama >/dev/null 2>&1; then
  log "Starting Ollama server in background..."
  nohup ollama serve > /dev/null 2>&1 &
  log "Ollama server started."
fi

exit 0
