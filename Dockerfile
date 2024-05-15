FROM node:lts

RUN npm install -g pnpm

WORKDIR /app
COPY package.json /app/package.json
COPY pnpm-lock.yaml /app/pnpm-lock.yaml
COPY tsconfig.json /app/tsconfig.json

RUN pnpm install
COPY src /app/src

CMD bash