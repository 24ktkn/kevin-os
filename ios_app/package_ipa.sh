#!/bin/bash
set -e

echo "🔍 Searching for the latest built KevinOS.app..."

# 1. Search in Xcode DerivedData (where Cmd+B outputs)
APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData -name "KevinOS.app" -type d -path "*iphoneos*" 2>/dev/null | xargs ls -td 2>/dev/null | head -n 1)

# 2. Fallback: Search in current repo / build directory
if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
    APP_PATH=$(find . -name "KevinOS.app" -type d -path "*iphoneos*" 2>/dev/null | xargs ls -td 2>/dev/null | head -n 1)
fi

# 3. If still not found, attempt building with xcodebuild if xcodeproj exists
if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
    PROJ_PATH=$(find . -name "*.xcodeproj" -maxdepth 2 2>/dev/null | head -n 1)
    if [ -n "$PROJ_PATH" ]; then
        echo "🔨 Building KevinOS via xcodebuild..."
        xcodebuild -project "$PROJ_PATH" \
                   -scheme KevinOS \
                   -configuration Release \
                   -destination 'generic/platform=iOS' \
                   -derivedDataPath ./build \
                   CODE_SIGNING_ALLOWED=NO \
                   build
        APP_PATH=$(find ./build -name "KevinOS.app" -type d 2>/dev/null | head -n 1)
    fi
fi

if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
    echo "❌ Error: Could not find KevinOS.app."
    echo "💡 Please open KevinOS in Xcode, press Cmd + B to build for 'Any iOS Device (arm64)', then re-run this script!"
    exit 1
fi

echo "✅ Found built app: $APP_PATH"
echo "📦 Packaging into ~/Desktop/KevinOS.ipa..."

# Clean up any existing Payload / KevinOS.ipa on Desktop
rm -rf ~/Desktop/Payload ~/Desktop/KevinOS.ipa
mkdir -p ~/Desktop/Payload

# Copy the app into Payload
cp -R "$APP_PATH" ~/Desktop/Payload/

# Compress into .ipa
cd ~/Desktop
zip -qr KevinOS.ipa Payload
rm -rf Payload

echo ""
echo "🎉 SUCCESS! KevinOS.ipa has been created on your Desktop."
echo "📍 Location: ~/Desktop/KevinOS.ipa"
echo "👉 Now drag KevinOS.ipa into Sideloadly and click Start!"
