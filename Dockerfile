FROM node:20-alpine
WORKDIR /app
COPY package.json proxy.mjs ./
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:8000/health || exit 1
CMD ["node", "proxy.mjs"]
