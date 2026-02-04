# Parameterized Dockerfile for multi-version Playwright support
# Build with: docker build --build-arg PLAYWRIGHT_VERSION=1.40.0 --build-arg BASE_IMAGE=jammy -t vrt-playwright:v1.40.0 .

ARG PLAYWRIGHT_VERSION=1.49.1
ARG BASE_IMAGE=noble
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-${BASE_IMAGE}

WORKDIR /app

# Re-declare ARG after FROM (Docker resets ARGs after FROM)
ARG PLAYWRIGHT_VERSION=1.49.1

# Install playwright package (browsers are pre-installed in base image)
RUN npm init -y && npm install playwright@${PLAYWRIGHT_VERSION}

# Copy runner scripts
COPY playwright-runner.js .
COPY batch-runner.js .

# Input/output directories will be mounted as volumes
# /input - contains scenario config JSON (or batch.json for batch mode)
# /output - screenshots will be saved here

# Default: single-task runner. For batch mode, override CMD:
# docker run ... node batch-runner.js
CMD ["node", "playwright-runner.js"]
