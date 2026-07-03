#!/usr/bin/env python3
"""Refresh Racing Post access token via AWS Cognito (REFRESH_TOKEN_AUTH).

Cognito access tokens duram 30 min — não cabe no cron diário sem renovação.
Esse script usa o REFRESH_TOKEN (dura ~30 dias) pra emitir um novo
ACCESS_TOKEN sem precisar passar pela tela de captcha do RP.

USER_PASSWORD_AUTH não funciona aqui porque o RP tem PreAuthentication
Lambda exigindo CAPTCHA_TOKEN.

Uso:
  python refresh_token.py [--rpscrape-env /path/to/rpscrape/.env]

Variáveis esperadas em /home/mazedev/rpscrape/.env (ou path passado):
  EMAIL=horsingmaze10@outlook.com
  REFRESH_TOKEN=<JWE do cookie .refreshToken>
  ACCESS_TOKEN=<atualizado automaticamente>

Refresh token rotation: Cognito pode (mas não sempre) emitir refresh token
novo a cada renovação. Se vier, salvamos por cima.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from dotenv import dotenv_values

# Constantes derivadas do source do rpscrape (utils/network.py) e do JWT decoded
COGNITO_REGION = "eu-west-1"
COGNITO_CLIENT_ID = "3fii107m4bmtggnm21pud2es21"

DEFAULT_RPSCRAPE_ENV = "/home/mazedev/rpscrape/.env"


def refresh_access_token(refresh_token: str) -> tuple[str, str | None]:
    """Faz REFRESH_TOKEN_AUTH e retorna (new_access_token, new_refresh_token_or_None)."""
    client = boto3.client(
        "cognito-idp",
        region_name=COGNITO_REGION,
        config=Config(signature_version="UNSIGNED"),
    )
    try:
        resp = client.initiate_auth(
            AuthFlow="REFRESH_TOKEN_AUTH",
            AuthParameters={
                "REFRESH_TOKEN": refresh_token,
            },
            ClientId=COGNITO_CLIENT_ID,
        )
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code")
        if code == "NotAuthorizedException":
            print("FAIL: NotAuthorizedException — REFRESH_TOKEN expirado ou revogado. Pegue novo via DevTools.", file=sys.stderr)
        else:
            print(f"FAIL: {code}: {e}", file=sys.stderr)
        raise

    auth = resp.get("AuthenticationResult", {})
    new_access = auth.get("AccessToken")
    new_refresh = auth.get("RefreshToken")  # geralmente None se rotação não habilitada
    if not new_access:
        raise RuntimeError(f"AuthenticationResult missing AccessToken: {resp}")
    return new_access, new_refresh


def update_env_file(env_path: Path, updates: dict[str, str]) -> None:
    """Lê o .env atual, atualiza chaves em `updates`, reescreve mantendo outras vars."""
    if not env_path.exists():
        raise FileNotFoundError(env_path)

    lines = env_path.read_text().splitlines(keepends=False)
    seen: set[str] = set()
    new_lines: list[str] = []
    for line in lines:
        replaced = False
        for key, value in updates.items():
            if line.startswith(f"{key}="):
                new_lines.append(f"{key}={value}")
                seen.add(key)
                replaced = True
                break
        if not replaced:
            new_lines.append(line)
    for key, value in updates.items():
        if key not in seen:
            new_lines.append(f"{key}={value}")

    tmp = env_path.with_suffix(env_path.suffix + ".tmp")
    tmp.write_text("\n".join(new_lines) + "\n")
    tmp.chmod(0o600)
    tmp.replace(env_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpscrape-env", default=DEFAULT_RPSCRAPE_ENV)
    args = ap.parse_args()

    env_path = Path(args.rpscrape_env).expanduser()
    creds = dotenv_values(env_path)
    email = creds.get("EMAIL")
    refresh = creds.get("REFRESH_TOKEN")
    if not email or not refresh:
        print(f"FAIL: EMAIL ou REFRESH_TOKEN ausente em {env_path}", file=sys.stderr)
        sys.exit(1)

    print(f"📥 refresh token via REFRESH_TOKEN_AUTH (email={email})", file=sys.stderr)
    new_access, new_refresh = refresh_access_token(refresh)
    updates = {"ACCESS_TOKEN": new_access}
    if new_refresh:
        updates["REFRESH_TOKEN"] = new_refresh
        print("ℹ refresh token rotated; salvando novo", file=sys.stderr)
    update_env_file(env_path, updates)
    print(f"✅ token renovado em {env_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
