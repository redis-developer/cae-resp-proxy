FROM oven/bun:alpine AS build

WORKDIR /app

COPY bun.lock package.json ./

RUN bun install --frozen-lockfile --production --verbose

COPY . .

RUN bun build --target bun --compile --minify --sourcemap ./src/index.ts --outfile resp-proxy

FROM oven/bun:alpine AS runner

# Required
ENV LISTEN_PORT="6379"
ENV TARGET_HOST=""
ENV TARGET_PORT=""

# Optional
ENV LISTEN_HOST="127.0.0.1"
ENV TIMEOUT=""
ENV ENABLE_LOGGING="false"
ENV API_PORT="3000"

#Default proxy port
EXPOSE 6379 
#Default api port
EXPOSE 3000

WORKDIR /app

COPY --from=build /app/resp-proxy .

ENTRYPOINT ["./resp-proxy"]
