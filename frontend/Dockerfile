FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN \
  if [ -f package-lock.json ]; then npm install; \
  elif [ -f yarn.lock ]; then yarn install; \
  elif [ -f pnpm-lock.yaml ]; then npm install -g pnpm && pnpm install; \
  else npm install; \
  fi

# Copy source
COPY . .

EXPOSE 3000

# Dev mode
CMD ["npm", "run", "dev"]
