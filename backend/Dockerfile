FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

RUN DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx prisma generate
RUN npm run build

ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/index.js"]