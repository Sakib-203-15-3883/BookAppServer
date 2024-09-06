#Sample Dockerfile for NodeJS Apps

FROM node:18.18.2

ENV NODE_ENV=production

WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install

COPY . .

EXPOSE 8080

CMD [ "node", "index.js" ]