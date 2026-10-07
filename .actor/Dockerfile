FROM apify/actor-node:22

COPY --chown=myuser package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && (npm list --omit=dev --all || true) \
    && node --version && npm --version

COPY --chown=myuser . ./
CMD npm start --silent
