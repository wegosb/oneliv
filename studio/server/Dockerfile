FROM node:20-alpine
WORKDIR /app
COPY server/ ./server/
COPY index.html ./index.html
ENV PORT=8787 PROVIDER=mock
EXPOSE 8787
CMD ["node","server/server.js"]
