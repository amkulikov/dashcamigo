# Self-build image: builds the app from this clone, serves it with nginx
# (docs/self-hosting.md):
#   docker build -t dashcamigo .
#   docker run -d -p 8080:80 dashcamigo
# The prebuilt image at ghcr.io/amkulikov/dashcamigo is NOT built from this
# file: the release workflow packages its already-built (and attested) dist/
# via docker/Dockerfile.prebuilt, so the image and the release archives are
# one artifact.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
