#!/usr/bin/env bash
# Install Whisper.cpp + download the multilingual medium model on the VPS.
# Idempotent - safe to re-run.

set -euo pipefail

INSTALL_DIR=${WHISPER_DIR:-/opt/whisper.cpp}
MODEL=${WHISPER_MODEL:-ggml-medium.bin}
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL}"

echo "[install-whisper] target dir: $INSTALL_DIR"
echo "[install-whisper] model:      $MODEL"

# Deps - apt-based (Debian/Ubuntu/Hostinger default)
if command -v apt-get >/dev/null 2>&1; then
  echo "[install-whisper] installing build deps via apt"
  sudo apt-get update -y
  sudo apt-get install -y build-essential cmake git curl ffmpeg
fi

# Clone or refresh whisper.cpp
if [ ! -d "$INSTALL_DIR/.git" ]; then
  echo "[install-whisper] cloning whisper.cpp"
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown "$(id -u):$(id -g)" "$INSTALL_DIR"
  git clone https://github.com/ggml-org/whisper.cpp "$INSTALL_DIR"
else
  echo "[install-whisper] updating whisper.cpp"
  git -C "$INSTALL_DIR" fetch --depth=1 origin
  git -C "$INSTALL_DIR" reset --hard origin/master
fi

# Build (CMake; main binary is `whisper-cli` in build/bin/)
echo "[install-whisper] building"
cd "$INSTALL_DIR"
cmake -B build
cmake --build build --config Release -j

# Download the model if missing
MODEL_PATH="$INSTALL_DIR/models/$MODEL"
if [ ! -f "$MODEL_PATH" ]; then
  echo "[install-whisper] downloading $MODEL (~1.5 GB)"
  mkdir -p "$INSTALL_DIR/models"
  curl -L --fail --progress-bar -o "$MODEL_PATH" "$MODEL_URL"
fi

echo "[install-whisper] verifying"
"$INSTALL_DIR/build/bin/whisper-cli" --help >/dev/null

echo
echo "[install-whisper] DONE."
echo "  Binary:  $INSTALL_DIR/build/bin/whisper-cli"
echo "  Model:   $MODEL_PATH"
echo
echo "Add these to ZAOscribe .env if your paths differ from the defaults:"
echo "  WHISPER_BIN=$INSTALL_DIR/build/bin/whisper-cli"
echo "  WHISPER_MODEL_PATH=$MODEL_PATH"
