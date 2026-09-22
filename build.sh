#!/bin/bash
set -e

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    pnpm install --ignore-scripts
fi

# Build the package
make build

# Create the release tarball
make package

echo "Build complete! Package ready for release."
