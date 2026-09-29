# fontokmai pipeline image: built and run on the VPS, not published to a registry.
# The machine is shared with other work: both stages and every RUN name fontokmai, so that
# deploy/vps/prune_own_cache.py can tell this project's build cache from anything else. uv and what it downloads
# stay in the build stage; the image holds only the environment it made.
FROM python:3.13-slim AS fontokmai-build
COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_NO_CACHE=1 UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project  # fontokmai
COPY src ./src
RUN uv sync --locked --no-dev --no-editable  # fontokmai

FROM python:3.13-slim AS fontokmai
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client \
 && rm -rf /var/lib/apt/lists/*  # fontokmai
# the container runs as the host user's uid (compose `user:`); ssh needs a passwd entry for that uid
ARG APP_UID=1000
ARG APP_GID=1000
RUN (getent group "$APP_GID" || groupadd --gid "$APP_GID" fontokmai) \
 && (getent passwd "$APP_UID" || useradd --uid "$APP_UID" --gid "$APP_GID" --home-dir /tmp --no-create-home \
     --shell /usr/sbin/nologin fontokmai)
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH" HOME=/tmp
COPY --from=fontokmai-build /app/.venv /app/.venv
# the commit the image is built from, for the round archive (deploy.sh passes it; empty when built by hand).
# Last, so that a new commit changes only this
ARG FONTOKMAI_CODE=""
ENV FONTOKMAI_CODE=$FONTOKMAI_CODE
ENTRYPOINT ["fontokmai"]
