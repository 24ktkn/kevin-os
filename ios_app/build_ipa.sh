#!/bin/bash
set -e

echo "🚀 Building KevinOS for iOS Device..."
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Clean and build KevinOS target
xcodebuild -project KevinOS.xcodeproj \
           -scheme KevinOS \
           -configuration Release \
           -destination 'generic/platform=iOS' \
           -derivedDataPath ./build \
           CODE_SIGNING_ALLOWED=NO \
           build

APP_PATH="./build/Build/Products/Release-iphoneos/KevinOS.app"

if [ ! -d "$APP_PATH" ]; then
    # Fallback to Debug if Release is not configured
    APP_PATH="./build/Build/Products/Debug-iphoneos/KevinOS.app"
fi

if [ ! -d "$APP_PATH" ]; then
    echo "❌ Error: Could not find built KevinOS.app"
    exit 1
fi

echo "📦 Packaging into KevinOS.ipa on your Desktop..."
rm -rf ~/Desktop/Payload ~/Desktop/KevinOS.ipa
mkdir -p ~/Desktop/Payload
cp -R "$APP_PATH" ~/Desktop/Payload/
cd ~/Desktop
zip -qr KevinOS.ipa Payload
rm -rf Payload

echo "🎉 SUCCESS! KevinOS.ipa has been created on your Desktop."
echo "👉 Now drag KevinOS.ipa into Sideloadly and click Start!"
