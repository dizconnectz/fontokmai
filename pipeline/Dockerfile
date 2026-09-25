# fontokmai pipeline image: built and run on the VPS, not published to a registry
FROM python:3.13-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /usr/local/bin/uv
# the container runs as the host user's uid (compose `user:`); ssh needs a passwd entry for that uid
ARG APP_UID=1000
ARG APP_GID=1000
RUN (getent group "$APP_GID" || groupadd --gid "$APP_GID" fontokmai) \
 && (getent passwd "$APP_UID" || useradd --uid "$APP_UID" --gid "$APP_GID" --home-dir /tmp --no-create-home \
     --shell /usr/sbin/nologin fontokmai)
WORKDIR /app
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH" HOME=/tmp
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN uv sync --locked --no-dev
ENTRYPOINT ["fontokmai"]
