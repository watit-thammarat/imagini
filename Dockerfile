FROM node
ADD . /opt/app
WORKDIR /opt/app
RUN npm i
EXPOSE 3000
CMD [ "npm", "start" ]