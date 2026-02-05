FROM mcr.microsoft.com/playwright:v1.10.0-focal

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  xvfb fluxbox x11vnc novnc websockify \
  && rm -rf /var/lib/apt/lists/*

# Ensure Playwright 1.10.0 node package is present
RUN npm init -y && npm i playwright@1.10.0

COPY start-vnc.sh /usr/local/bin/start-vnc.sh
RUN chmod +x /usr/local/bin/start-vnc.sh

ENV DISPLAY=:99
ENV TARGET_URL=http://host.docker.internal:3000
ENV BROWSER=chromium

CMD ["/usr/local/bin/start-vnc.sh"]
