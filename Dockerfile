FROM oven/bun:1

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

RUN mkdir -p /app/data

ENV PORT=8080
EXPOSE 8080

CMD ["bun", "run", "src/index.ts"]
