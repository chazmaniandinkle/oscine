#!/bin/bash
# Fetch the smoke-test GGUFs from audio-cpp/audio.cpp-gguf, one writer per file,
# and verify each against the sha256 Hugging Face publishes (X-Linked-ETag).
cd "$(dirname "$0")/.." || exit 1
for f in "$@"; do
  url="https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main/$f"
  want=$(curl -sIL "$url" | grep -i '^x-linked-etag' | tr -d '"\r' | awk '{print $2}')
  mkdir -p "weights/$(dirname "$f")"
  curl -sSL -C - --retry 3 -o "weights/$f" "$url"
  got=$(shasum -a 256 "weights/$f" | awk '{print $1}')
  [ "$got" = "$want" ] && echo "OK $f $got" || echo "MISMATCH $f got=$got want=$want"
done
