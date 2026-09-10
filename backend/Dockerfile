FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node scripts/bootstrap-admin.js ./scripts/bootstrap-admin.js
COPY --chown=node:node scripts/ecpay-poll.js ./scripts/ecpay-poll.js
COPY --chown=node:node scripts/ecpay-query.js ./scripts/ecpay-query.js
RUN mkdir -p uploads && chown node:node uploads
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
