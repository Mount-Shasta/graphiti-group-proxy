FROM node:20-alpine
WORKDIR /app
COPY package.json proxy.mjs ./
EXPOSE 8000
CMD ["node", "proxy.mjs"]
