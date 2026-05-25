# PulseWatch

PulseWatch is a small native SwiftUI iPhone app that presents a watch-style face plus a simple stopwatch.

## Local macOS Build

Install XcodeGen, generate the Xcode project, then build or run the app in Xcode:

```sh
brew install xcodegen
xcodegen generate
open PulseWatch.xcodeproj
```

## GitHub Actions Build

The `iOS Build` workflow runs on a macOS runner, generates the Xcode project, and builds the app for the generic iOS Simulator destination with code signing disabled. It is intentionally build/test validation, not an interactive simulator session.
