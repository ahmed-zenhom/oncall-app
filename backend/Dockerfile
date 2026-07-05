FROM node:22.5-alpine

WORKDIR /app

RUN apk add --no-cache sqlite

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p exports

ENV PORT=4000
EXPOSE 4000

CMD ["npm", "start"]
